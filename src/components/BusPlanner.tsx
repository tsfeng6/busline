import { getBuslineAIEndpoint, readBuslineAIResponse, describeBuslineAIError } from '../utils/buslineAIClient';
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Route, Loader2, Footprints, Bus, Search } from 'lucide-react';
import { BusPlan, PlannerPoint, normalizeBusPlan, plannerDistance, plannerDuration } from '../utils/busPlanner';
interface Props { onClose: () => void; disabled: boolean; onDraw: (plan: BusPlan) => void; onClear: () => void }
export function BusPlanner({ onClose, disabled, onDraw, onClear }: Props) {
  const [originCity, setOriginCity] = useState('北京市');
  const [origin, setOrigin] = useState('北京西站');
  const [destinationCity, setDestinationCity] = useState('石家庄市');
  const [destination, setDestination] = useState('石家庄站');
  const [via, setVia] = useState('');
  const [maxWalk, setMaxWalk] = useState(10);
  const [busy, setBusy] = useState(false);
  const [enableAI, setEnableAI] = useState(true);
  const [aiNotes, setAINotes] = useState<string[]>([]);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [plans, setPlans] = useState<BusPlan[]>([]);
  const [selected, setSelected] = useState(0);
  const [resolved, setResolved] = useState<PlannerPoint[]>([]);
  const sessionRef = useRef(0);
  useEffect(() => () => { sessionRef.current++; aiAbortRef.current?.abort(); }, []);
  const search = async () => {
    if (busy || disabled || !origin.trim() || !destination.trim() || !originCity.trim() || !destinationCity.trim()) return;
    const AMap = (window as any).AMap;
    if (!AMap?.Transfer || !AMap?.PlaceSearch) { setError('地图服务尚未就绪，请稍后重试。'); return; }
    const session = ++sessionRef.current;
    const isCurrent = () => session === sessionRef.current;
    setBusy(true); setError(''); setPlans([]); setResolved([]); setAINotes([]); onClear();
    let transferCalls = 0, aiCalls = 0;
    const pointCache = new Map<string, PlannerPoint>();
    const merge = (before: BusPlan[], after: BusPlan[]): BusPlan[] => before.flatMap(a => after.map(b => ({ steps: [...a.steps, ...b.steps], time: a.time + b.time,
      distance: a.distance + b.distance, walking: a.walking + b.walking, buses: a.buses + b.buses })))
      .filter(plan => plan.walking <= maxWalk * 1000).sort((a, b) => a.time - b.time).slice(0, 3);
    const empty: BusPlan = { steps: [], time: 0, distance: 0, walking: 0, buses: 0 };
    const check = () => { if (!isCurrent()) throw new Error('规划已取消。'); };
    const locate = async (request: { city: string; name: string }): Promise<PlannerPoint> => {
      check();
      const key = `${request.city}|${request.name}`;
      if (pointCache.has(key)) return pointCache.get(key)!;
      setStatus(`正在定位：${request.city} · ${request.name}`);
      const point = await new Promise<PlannerPoint>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`定位${request.name}超时`)), 12000);
        new AMap.PlaceSearch({ city: request.city, citylimit: true, pageSize: 5, extensions: 'base' }).search(request.name, (state: string, result: any) => {
          clearTimeout(timer);
          const pois = result?.poiList?.pois || [];
          const poi = pois.find((item: any) => item.name === request.name) || pois[0];
          if (state !== 'complete' || !poi?.location) { reject(new Error(`无法定位${request.city}的“${request.name}”，请填写更具体地点。`)); return; }
          resolve({ city: request.city, name: poi.name, location: [poi.location.lng, poi.location.lat] });
        });
      });
      check(); pointCache.set(key, point); return point;
    };
    const tryConnection = async (from: PlannerPoint, to: PlannerPoint, depth: number): Promise<{ plans: BusPlan[]; points: PlannerPoint[] }> => {
      check();
      if (++transferCalls > 24) throw new Error('已达到本轮24次路段验证上限，请缩小范围或指定换乘点后重试。');
      setStatus(`正在验证路段（${transferCalls}/24）：${from.name} → ${to.name}`);
      const raw = await new Promise<any[]>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('公交规划超时，请缩短路段后重试。')), 25000);
        new AMap.Transfer({ city: from.city, cityd: to.city, policy: AMap.TransferPolicy.NO_SUBWAY, nightflag: true, extensions: 'all' })
          .search(from.location, to.location, (state: string, result: any) => {
            clearTimeout(timer);
            if (state === 'error') { reject(new Error('公交接口请求失败，可能为额度、权限或跨城服务限制。')); return; }
            resolve(state === 'complete' ? result?.plans || [] : []);
          });
      });
      check();
      const valid = raw.map(plan => normalizeBusPlan(plan, maxWalk * 1000)).filter(Boolean) as BusPlan[];
      if (valid.length) return { plans: valid.slice(0, 3), points: [from, to] };
      if (!enableAI || depth >= 2 || aiCalls >= 3) throw new Error(`未找到符合条件的连接：${from.city} ${from.name} → ${to.city} ${to.name}。\n未验证通过的路段不会被当作完整方案；可调整中间换乘站后重试。`);
      aiCalls++;
      setStatus(`Busline AI 正在深度思考接驳点（${aiCalls}/3）：${from.name} → ${to.name}`);
      const controller = new AbortController(); aiAbortRef.current = controller;
      const timer = window.setTimeout(() => controller.abort(), 190000);
      let suggestion: any;
      try {
        const res = await fetch(getBuslineAIEndpoint(import.meta.env.VITE_API_BASE_URL || '', window.location.href), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ mode: 'planner', message: '这段路线高德直搜未找到符合纯城市公交与步行条件的结果。请提出实际公交接驳站作为中间点，供逐段核验。',
            context: { origin: { city: from.city, name: from.name }, destination: { city: to.city, name: to.name }, maxWalkingKm: maxWalk,
              previouslyLocated: Array.from(pointCache.values()).map(point => ({ city: point.city, name: point.name })), excludedModes: ['地铁', '铁路', '机场巴士', '长途客运'] } }) });
        suggestion = await readBuslineAIResponse(res);
      } catch (e: any) { throw new Error(controller.signal.aborted ? 'Busline AI 请求已停止或超时，请重试。' : describeBuslineAIError(e)); }
      finally { clearTimeout(timer); aiAbortRef.current = null; }
      check();
      setAINotes(prev => [...prev, `${from.name} → ${to.name}\n${suggestion.reply || ''}`]);
      const unique = new Set<string>();
      const candidates = (Array.isArray(suggestion.waypoints) ? suggestion.waypoints : []).filter((point: any) => {
        if (!point?.city || !point?.name) return false;
        const key = `${point.city}|${point.name}`;
        if (unique.has(key) || (point.city === from.city && point.name === from.name) || (point.city === to.city && point.name === to.name)) return false;
        unique.add(key); return true;
      }).slice(0, 8);
      if (!candidates.length) throw new Error('Busline AI 未能提出有把握的中间接驳站，当前不能生成完整方案。');
      const points = [from];
      for (const candidate of candidates) {
        const point = await locate(candidate);
        if ([from, to, ...points].some(known => Math.abs(known.location[0] - point.location[0]) < 0.0001 && Math.abs(known.location[1] - point.location[1]) < 0.0001)) continue;
        points.push(point);
      }
      points.push(to);
      if (points.length < 3) throw new Error('AI 接点与起终点重复，请手动指定更具体的换乘站。');
      setResolved(points);
      let combined = [empty];
      const verifiedPoints: PlannerPoint[] = [from];
      for (let index = 0; index < points.length - 1; index++) {
        const result = await tryConnection(points[index], points[index + 1], depth + 1);
        combined = merge(combined, result.plans);
        if (!combined.length) throw new Error('组合方案的总步行距离超过限制，请调整接点或步行上限。');
        verifiedPoints.push(...result.points.slice(1));
      }
      return { plans: combined, points: verifiedPoints };
    };
    try {
      const intermediate = via.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        const split = line.indexOf('|');
        if (split < 1 || !line.slice(split + 1).trim()) throw new Error('途经点格式应为“城市|地点”，每行一个。');
        return { city: line.slice(0, split).trim(), name: line.slice(split + 1).trim() };
      });
      if (intermediate.length > 8) throw new Error('试验版最多支持8个手动途经点。');
      const requests = [{ city: originCity.trim(), name: origin.trim() }, ...intermediate, { city: destinationCity.trim(), name: destination.trim() }];
      const points: PlannerPoint[] = [];
      for (const request of requests) points.push(await locate(request));
      check(); setResolved(points);
      let combined = [empty];
      const verifiedPoints = [points[0]];
      for (let index = 0; index < points.length - 1; index++) {
        const result = await tryConnection(points[index], points[index + 1], 0);
        combined = merge(combined, result.plans);
        if (!combined.length) throw new Error('组合方案的步行总距离超过限制，请调整换乘点。');
        verifiedPoints.push(...result.points.slice(1));
      }
      check();
      setResolved(verifiedPoints); setPlans(combined); setSelected(0); onDraw(combined[0]);
      setStatus(`已逐段验证 ${transferCalls} 次，找到公交与步行候选方案${aiCalls ? '（含 AI 接驳建议）' : ''}`);
    } catch (e: any) { if (isCurrent()) { setError(e.message || '规划失败，请重试。'); setStatus(''); } }
    finally { if (isCurrent()) setBusy(false); }
  };
  const field = 'w-full rounded-xl border border-m3-outline-variant/50 bg-m3-surface-container px-3 py-2 text-xs outline-none focus:border-m3-primary';
  return <motion.aside initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }}
    aria-label="公交路线规划" className="fixed top-20 left-4 bottom-24 z-[75] w-[calc(100vw-32px)] sm:w-[400px] flex flex-col rounded-3xl bg-m3-surface/95 backdrop-blur-xl border border-m3-outline-variant/50 shadow-2xl pointer-events-auto overflow-hidden">
    <div className="flex justify-between items-center px-4 py-3 border-b border-m3-outline-variant/30"><h2 className="text-sm font-black text-m3-primary flex items-center gap-2"><Route className="w-4 h-4" />公交规划 · 试验版</h2><button onClick={onClose} aria-label="关闭公交规划" className="p-2 rounded-full hover:bg-m3-primary/10"><X className="w-4 h-4" /></button></div>
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-3">
      <p className="text-[11px] text-slate-500 leading-relaxed">只接受公交和步行，排除地铁、铁路、机场巴士及可识别的长途客运。跨城数据可能不完整，候选方案仍需核实班次与换乘时间。</p>
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="space-y-2">
        <div className="grid grid-cols-[100px_1fr] gap-2"><input aria-label="出发城市" disabled={busy} className={field} value={originCity} onChange={e => setOriginCity(e.target.value)} /><input aria-label="出发地点" disabled={busy} className={field} value={origin} onChange={e => setOrigin(e.target.value)} /></div>
        <div className="grid grid-cols-[100px_1fr] gap-2"><input aria-label="到达城市" disabled={busy} className={field} value={destinationCity} onChange={e => setDestinationCity(e.target.value)} /><input aria-label="到达地点" disabled={busy} className={field} value={destination} onChange={e => setDestination(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-xs font-bold text-m3-primary py-1"><input type="checkbox" checked={enableAI} disabled={busy} onChange={e => setEnableAI(e.target.checked)} className="accent-m3-primary" />Busline AI 辅助跨城接驳</label>
        <p className="text-[10px] text-slate-500">直搜失败后，AI 深度思考中间接点，再用地图逐段验证。每轮最多3次 AI 分析、24次路段查询。</p>
        <details><summary className="text-xs font-bold text-m3-primary cursor-pointer py-1">分段规划与步行设置</summary>
          <p className="text-[10px] text-slate-500 my-2">添加明确换乘点，每行“城市|地点”；各段共用同一个接点，不会省略中间断点。分段结果不保证当日赶得上全部班次。</p>
          <textarea aria-label="途经换乘点" rows={3} disabled={busy} value={via} onChange={e => setVia(e.target.value)} placeholder={'涿州市|具体公交换乘站名\n保定市|具体公交换乘站名'} className={field} />
          <label className="text-xs text-slate-600 flex items-center gap-2 mt-2">总步行上限<input aria-label="总步行上限（公里）" type="number" min={1} max={50} disabled={busy} value={maxWalk} onChange={e => setMaxWalk(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="w-16 rounded-lg p-1 border border-m3-outline-variant" />公里</label>
        </details>
        <button type="submit" aria-label="开始公交规划" disabled={busy || disabled} className="w-full rounded-xl bg-m3-primary text-white py-2.5 flex justify-center disabled:opacity-40">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</button>
      </form>
      {status && <p role="status" className="text-xs text-m3-primary">{status}</p>}
      {aiNotes.length > 0 && <details className="rounded-xl bg-m3-primary-container/40 p-3"><summary className="text-xs font-bold text-m3-primary cursor-pointer">Busline AI 接驳建议（待逐段验证）</summary>{aiNotes.map((note, index) => <p key={index} className="text-[11px] whitespace-pre-wrap leading-relaxed mt-2 text-slate-600">{note}</p>)}</details>}
      {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 whitespace-pre-wrap leading-relaxed">{error}</p>}
      {resolved.length > 0 && <div className="text-[10px] text-slate-500">已定位：{resolved.map(point => `${point.city}·${point.name}`).join(' → ')}</div>}
      {plans.length > 0 && <>
        <div className="flex gap-2">{plans.map((plan, index) => <button key={index} onClick={() => { setSelected(index); onDraw(plan); }} className={`flex-1 rounded-xl p-2 text-[11px] ${selected === index ? 'bg-m3-primary text-white' : 'bg-m3-surface-container text-slate-600'}`}>方案{index + 1}<br />{plannerDuration(plan.time)}<br />步行{plannerDistance(plan.walking)}</button>)}</div>
        <p className="text-[10px] text-slate-500">公交 {plans[selected].buses} 段 · 全程{plannerDistance(plans[selected].distance)}。耗时为接口估算，分段方案未计入跨段候车等待；不保证当天可完成。</p>
        {plans[selected].steps.map((step, index) => <div key={index} className="rounded-2xl border border-m3-outline-variant/40 p-3 flex gap-2 text-xs leading-relaxed">{step.mode === 'WALK' ? <Footprints className="w-4 h-4 shrink-0 text-amber-700" /> : <Bus className="w-4 h-4 shrink-0 text-m3-primary" />}<span>{index + 1}. {step.instruction}</span></div>)}
      </>}
    </div>
  </motion.aside>;
}
