import { getBuslineAIEndpoint, readBuslineAIResponse, describeBuslineAIError } from '../utils/buslineAIClient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, ArrowDownUp, Copy, Loader2, Footprints, Bus, Search } from 'lucide-react';
import { BusPlan, PlannerPoint, normalizeBusPlan, plannerBusSequence, plannerDistance, plannerPlanText } from '../utils/busPlanner';
import { loadGameCity, loadPublishedCities } from '../utils/publishedTransit';
import { plannerCityKey, plannerCorridorCities, plannerCorridorWidths, prioritizePlannerCities } from '../utils/plannerCityCoverage';
import { collectPlannerStations, matchPlannerStations } from '../utils/plannerStops';
import { PlannerStationField, type PlannerStationInput } from './PlannerStationField';
import { MAX_TRANSFER_RADIUS, paretoBusPlans, planSavedBus, recommendedBusPlans, transfers } from '../utils/savedBusPlanner';
import { verifyWalking } from '../utils/plannerWalking';
interface Props {
  onClose: () => void;
  disabled: boolean;
  currentCity: string;
  onMapPick: (handler: ((station: PlannerPoint) => void) | null) => void;
  onPreload: (active: boolean) => void;
  onSearchStart: () => void;
  onDraw: (plan: BusPlan) => void;
  onClear: () => void;
}
export function BusPlanner({ onClose, disabled, currentCity, onMapPick, onPreload, onSearchStart, onDraw, onClear }: Props) {
  const initialCity = currentCity && currentCity !== '全国' ? currentCity : '北京市';
  const [origin, setOrigin] = useState<PlannerStationInput>({ city: initialCity, name: '' });
  const [destination, setDestination] = useState<PlannerStationInput>({ city: initialCity, name: '' });
  const [picking, setPicking] = useState<'起点' | '终点' | null>(null);
  const [via, setVia] = useState('');
  const [maxWalk, setMaxWalk] = useState(10);
  const [busy, setBusy] = useState(false);
  const [enableAI, setEnableAI] = useState(false);
  const [aiNotes, setAINotes] = useState<string[]>([]);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [plans, setPlans] = useState<BusPlan[]>([]);
  const [selected, setSelected] = useState(0);
  const [order, setOrder] = useState<'推荐' | '少换乘' | '少步行'>('推荐');
  const [planPoints, setPlanPoints] = useState<PlannerPoint[]>([]);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [resolved, setResolved] = useState<PlannerPoint[]>([]);
  const sessionRef = useRef(0);
  const cityReads = useRef(new Map<string, ReturnType<typeof loadGameCity>>());
  const stationData = useRef(new Map<string, Promise<ReturnType<typeof collectPlannerStations>>>());
  const readCity = useCallback((city: string) => {
    const key = plannerCityKey(city);
    let pending = cityReads.current.get(key);
    if (!pending) {
      pending = loadGameCity(city.trim()).finally(() => { cityReads.current.delete(key); });
      cityReads.current.set(key, pending);
    }
    return pending;
  }, []);
  const loadStations = useCallback((city: string) => {
    const key = plannerCityKey(city);
    let pending = stationData.current.get(key);
    if (!pending) {
      const task = readCity(city).then(collectPlannerStations).catch(error => {
        if (stationData.current.get(key) === task) stationData.current.delete(key);
        throw error;
      });
      pending = task;
      stationData.current.set(key, task);
      if (stationData.current.size > 6) {
        const oldest = stationData.current.keys().next().value;
        if (oldest !== undefined) stationData.current.delete(oldest);
      }
    }
    return pending;
  }, [readCity]);
  const stopPicking = useCallback(() => { onMapPick(null); setPicking(null); }, [onMapPick]);
  const pick = (label: '起点' | '终点') => {
    setPicking(label);
    onMapPick(station => {
      (label === '起点' ? setOrigin : setDestination)({ city: station.city, name: station.name, station });
      stopPicking();
    });
  };
  useEffect(() => { if (disabled) stopPicking(); }, [disabled, stopPicking]);
  useEffect(() => () => { onMapPick(null); onPreload(false); sessionRef.current++; aiAbortRef.current?.abort(); }, [onMapPick, onPreload]);
  const search = async () => {
    if (busy || disabled || picking || !origin.name.trim() || !destination.name.trim() || !origin.city.trim() || !destination.city.trim()) return;
    const AMap = (window as any).AMap;
    if (!AMap) { setError('地图服务尚未就绪，请稍后重试。'); return; }
    const session = ++sessionRef.current;
    const isCurrent = () => session === sessionRef.current;
    onSearchStart();
    setBusy(true); setError(''); setResolved([]); setAINotes([]);
    let transferCalls = 0, aiCalls = 0;
    const pointCache = new Map<string, PlannerPoint>();
    const merge = (before: BusPlan[], after: BusPlan[]) => paretoBusPlans(before.flatMap(a => after.map(b => ({
      steps: [...a.steps, ...b.steps], time: a.time + b.time, distance: a.distance + b.distance,
      walking: a.walking + b.walking, buses: a.buses + b.buses,
    }))).filter(plan => plan.walking <= maxWalk * 1000));
    const empty: BusPlan = { steps: [], time: 0, distance: 0, walking: 0, buses: 0 };
    const check = () => { if (!isCurrent()) throw new Error('规划已取消。'); };
    const locate = async (request: PlannerStationInput): Promise<PlannerPoint> => {
      check();
      if (request.station) return request.station;
      const key = `${plannerCityKey(request.city)}|${request.name.trim()}`;
      if (pointCache.has(key)) return pointCache.get(key)!;
      const matches = matchPlannerStations(await loadStations(request.city), request.name, true);
      check();
      if (!matches.length) throw new Error(`${request.city}没有收录“${request.name.trim()}”公交站，请检查站名和城市，或在地图上选站。`);
      if (matches.length !== 1) throw new Error(`“${request.name.trim()}”有多个站点，请根据线路从提示中选择，或在地图上选站。`);
      pointCache.set(key, matches[0]);
      return matches[0];
    };
    const catalogTask = loadPublishedCities().then(cities => ({ cities, failed: false }), () => ({ cities: [], failed: true }));
    const unavailableCities = new Set<string>();
    let catalogFailed = false;
    const walkingCache = new Map<string, ReturnType<typeof verifyWalking>>();
    const trySavedConnection = async (from: PlannerPoint, to: PlannerPoint, onCandidates: () => void) => {
      const verify = (start: PlannerPoint['location'], end: PlannerPoint['location']) => {
        const key = `${start.join(',')}>${end.join(',')}`;
        const cached = walkingCache.get(key);
        if (cached) return cached;
        if (!AMap.Walking) return Promise.resolve(null);
        const pending = verifyWalking(AMap, start, end, 8_000);
        walkingCache.set(key, pending);
        return pending;
      };
      setStatus('正在查找沿途已收录线网…');
      const { cities: catalog, failed } = await catalogTask;
      catalogFailed ||= failed;
      const attempted = new Set<string>();
      const networks: Awaited<ReturnType<typeof readCity>>[] = [];
      for (const radius of plannerCorridorWidths(from, to)) {
        check();
        const pendingCities = plannerCorridorCities(catalog, from, to, radius).filter(city => !attempted.has(plannerCityKey(city)));
        if (!pendingCities.length) continue;
        onPreload(true);
        try {
          setStatus('正在确认沿途城市…');
          const cities = await prioritizePlannerCities(AMap, pendingCities, from, to, () => !isCurrent());
          check();
          for (let offset = 0; offset < cities.length; offset += 2) {
            check();
            setStatus(`正在预载沿途线网（${offset}/${cities.length}）…`);
            const results = await Promise.allSettled(cities.slice(offset, offset + 2).map(readCity));
            results.forEach((result, index) => {
              const city = cities[offset + index];
              attempted.add(plannerCityKey(city));
              if (result.status === 'fulfilled') networks.push(result.value);
              else unavailableCities.add(city);
            });
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } finally {
          if (isCurrent()) onPreload(false);
        }
        check();
        setStatus('正在比较换乘次数与步行距离…');
        const results = await planSavedBus(networks.flatMap(data => data.lines), from, to, maxWalk * 1000, verify, () => !isCurrent(), () => {
          setStatus('正在核验步行接驳…');
          onCandidates();
        });
        if (results.length) return results;
      }
      return [];
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
      if (valid.length) return { plans: paretoBusPlans(valid), points: [from, to] };
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
      finally { clearTimeout(timer); if (aiAbortRef.current === controller) aiAbortRef.current = null; }
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
        const point = await locate(candidate).catch(() => null);
        check();
        if (!point) continue;
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
        if (split < 1 || !line.slice(split + 1).trim()) throw new Error('途经点格式应为“城市|公交站名”，每行一个。');
        return { city: line.slice(0, split).trim(), name: line.slice(split + 1).trim() };
      });
      if (intermediate.length > 8) throw new Error('试验版最多支持8个手动途经点。');
      setStatus('正在确认公交站点…');
      const points = await Promise.all([origin, ...intermediate, destination].map(locate));
      check(); setResolved(points);
      let combined = [empty];
      const verifiedPoints = [points[0]];
      for (let index = 0; index < points.length - 1; index++) {
        const from = points[index], to = points[index + 1];
        let savedPlans: BusPlan[] = [];
        let hadCandidates = false;
        try {
          savedPlans = await trySavedConnection(from, to, () => { hadCandidates = true; });
        } catch (error) {
          if (!enableAI) throw error;
        }
        check();
        if (!savedPlans.length && !enableAI) throw new Error(catalogFailed || unavailableCities.size
          ? '部分沿途线网暂时无法读取，现有数据未找到完整方案。请稍后重试或开启备用规划。'
          : hadCandidates
            ? '已找到公交接续，但未能核验出符合总步行上限的完整方案。可检查步行上限，或开启备用规划。'
            : '沿途已收录的公交线路目前无法在设定的步行范围内接续。可指定途经公交站，或开启备用规划。');
        const result = savedPlans.length ? { plans: savedPlans, points: [from, to] } : await tryConnection(from, to, 0);
        combined = merge(combined, result.plans);
        if (!combined.length) throw new Error('组合方案的步行总距离超过限制，请调整换乘点。');
        verifiedPoints.push(...result.points.slice(1));
      }
      check();
      const recommendations = recommendedBusPlans(combined);
      onClear();
      onDraw(recommendations[0]);
      setResolved(verifiedPoints); setPlanPoints(verifiedPoints); setPlans(recommendations); setSelected(0); setOrder('推荐'); setCopyState('idle');
      setStatus(transferCalls ? '部分路段使用备用规划。' : catalogFailed || unavailableCities.size
        ? '已找到方案，部分沿途线网暂时无法读取。' : '已找到基于 Busline 收录线网的方案。');
    } catch (e: any) { if (isCurrent()) { setError(e.message || '规划失败，请重试。'); setStatus(''); } }
    finally { if (isCurrent()) setBusy(false); }
  };
  const field = 'w-full rounded-lg bg-m3-surface-container/75 px-2 py-2.5 text-xs outline-none focus:ring-1 focus:ring-m3-primary';
  const selectedPlan = plans[selected];
  const rankedPlans = plans.map((plan, index) => ({ plan, index }));
  if (order === '少步行') rankedPlans.sort((a, b) => a.plan.walking - b.plan.walking || transfers(a.plan) - transfers(b.plan));
  if (order === '少换乘') rankedPlans.sort((a, b) => transfers(a.plan) - transfers(b.plan) || a.plan.walking - b.plan.walking);
  const copyPlan = async () => {
    if (!selectedPlan) return;
    try {
      await navigator.clipboard.writeText(plannerPlanText(selectedPlan, planPoints));
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  };
  return <motion.aside initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }}
    aria-label="公交路线规划" className="fixed top-20 left-4 z-[75] w-[calc(100vw-32px)] sm:w-[400px] max-h-[calc(100dvh-9rem)] flex flex-col gap-2 pointer-events-none">
    <div className="pointer-events-auto rounded-2xl bg-m3-surface border border-m3-outline-variant/50 shadow-lg">
    <div className="flex justify-between items-center px-4 py-2 border-b border-m3-outline-variant/30"><h2 className="text-sm font-black text-m3-primary flex items-center gap-2"><Bus className="w-4 h-4" />公交规划</h2><button onClick={() => { stopPicking(); onClose(); }} aria-label="关闭公交规划" className="p-2 rounded-full hover:bg-m3-primary/10"><X className="w-4 h-4" /></button></div>
    {picking && <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
      <p role="status">放大地图后点击公交站圆点，设为{picking}。</p>
      <button type="button" className="shrink-0 font-bold text-m3-primary" onClick={stopPicking}>取消选站</button>
    </div>}
      <form hidden={Boolean(picking)} onSubmit={event => { event.preventDefault(); void search(); }} className="space-y-2 px-3 py-3 max-h-[48dvh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || disabled} aria-label="交换起点与终点" title="交换起点与终点"
            onClick={() => { setOrigin(destination); setDestination(origin); }} className="shrink-0 rounded-full p-1.5 text-m3-primary hover:bg-m3-primary-container disabled:opacity-40"><ArrowDownUp className="h-4 w-4" /></button>
          <div className="min-w-0 flex-1 space-y-1.5">
            <PlannerStationField label="起点" value={origin} onChange={setOrigin} load={loadStations} onPick={() => pick('起点')} disabled={busy || disabled} fieldClassName={field} />
            <PlannerStationField label="终点" value={destination} onChange={setDestination} load={loadStations} onPick={() => pick('终点')} disabled={busy || disabled} fieldClassName={field} />
          </div>
        </div>
        <details><summary className="text-xs font-bold text-m3-primary cursor-pointer py-1">规划设置</summary>
          <label className="flex items-center gap-2 text-xs font-bold text-m3-primary py-1"><input type="checkbox" checked={enableAI} disabled={busy} onChange={e => setEnableAI(e.target.checked)} className="accent-m3-primary" />收录线网无结果时，尝试高德与 AI 备用规划</label>
          <p className="text-[10px] text-slate-500 my-2">自动搜索沿途城市线网。换乘站直线间距最多 {MAX_TRANSFER_RADIUS} 米。可指定途经站，每行填“城市|公交站名”。</p>
          <textarea aria-label="途经换乘点" rows={3} disabled={busy} value={via} onChange={e => setVia(e.target.value)} placeholder={'涿州市|具体公交换乘站名\n保定市|具体公交换乘站名'} className={field} />
          <label className="text-xs text-slate-600 flex items-center gap-2 mt-2">总步行上限<input aria-label="总步行上限（公里）" type="number" min={1} max={50} disabled={busy} value={maxWalk} onChange={e => setMaxWalk(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="w-16 rounded-lg p-1 border border-m3-outline-variant" />公里</label>
        </details>
        {busy ? <button type="button" onClick={() => {
          sessionRef.current++;
          aiAbortRef.current?.abort();
          onPreload(false);
          setBusy(false);
          setStatus('已取消规划。');
        }} className="w-full rounded-xl border border-m3-outline-variant/50 py-2.5 flex items-center justify-center gap-2 text-xs font-bold text-m3-primary"><Loader2 className="w-4 h-4 animate-spin" />取消规划</button>
          : <button type="submit" disabled={disabled || !origin.name.trim() || !destination.name.trim() || !origin.city.trim() || !destination.city.trim()} className="w-full rounded-xl bg-m3-primary text-white py-2.5 flex items-center justify-center gap-2 text-xs font-bold disabled:opacity-40"><Search className="w-4 h-4" />开始公交规划</button>}
      </form>
    </div>
    {!picking && (status || error || aiNotes.length > 0 || selectedPlan) && <div className="pointer-events-auto min-h-0 overflow-y-auto custom-scrollbar rounded-2xl bg-m3-surface border border-m3-outline-variant/50 shadow-lg p-3 space-y-3">
      {status && <p role="status" className="text-xs text-m3-primary">{status}</p>}
      {aiNotes.length > 0 && <details className="rounded-xl bg-m3-primary-container/40 p-3"><summary className="text-xs font-bold text-m3-primary cursor-pointer">Busline AI 接驳建议（待逐段验证）</summary>{aiNotes.map((note, index) => <p key={index} className="text-[11px] whitespace-pre-wrap leading-relaxed mt-2 text-slate-600">{note}</p>)}</details>}
      {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 whitespace-pre-wrap leading-relaxed">{error}</p>}
      {!selectedPlan && resolved.length > 0 && <div className="text-[10px] text-slate-500">已定位：{resolved.map(point => `${point.city}·${point.name}`).join(' → ')}</div>}
      {selectedPlan && <>
        <div aria-label="方案排序" className="flex gap-1 rounded-xl bg-m3-surface-container p-1">
          {(['推荐', '少换乘', '少步行'] as const).map(option => <button key={option} type="button" aria-pressed={order === option} onClick={() => setOrder(option)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${order === option ? 'bg-m3-surface text-m3-primary shadow-sm' : 'text-slate-600'}`}>{option}</button>)}
        </div>
        <div className="space-y-1.5">{rankedPlans.map(({ plan, index }) => <button key={index} type="button" aria-pressed={selected === index} onClick={() => {
          try { onDraw(plan); setSelected(index); setCopyState('idle'); }
          catch { setError('地图状态已改变，请重新规划。'); }
        }} className={`block w-full rounded-xl border px-3 py-2.5 text-left ${selected === index ? 'border-m3-primary/50 bg-m3-primary-container/55' : 'border-m3-outline-variant/40 hover:bg-m3-surface-container'}`}>
          <span className="block line-clamp-3 text-sm font-bold text-m3-primary">{plannerBusSequence(plan)}</span>
          <span className="mt-1 block text-xs text-slate-600">{plannerDistance(plan.distance)} · 换乘 {transfers(plan)} 次 · 步行 {plannerDistance(plan.walking)}</span>
        </button>)}</div>
        <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold">行程详情</h3>
          <button type="button" onClick={() => void copyPlan()} className="flex items-center gap-1 rounded-lg bg-m3-primary-container px-2.5 py-1.5 text-xs font-bold text-m3-primary"><Copy className="h-3.5 w-3.5" />{copyState === 'copied' ? '已复制' : '复制方案'}</button></div>
        {copyState === 'manual' && <textarea aria-label="方案文本，选中后复制" readOnly rows={5} value={plannerPlanText(selectedPlan, planPoints)} onFocus={event => event.currentTarget.select()} className={field} />}
        <ol className="space-y-2 border-l border-m3-outline-variant/45 pl-3">{selectedPlan.steps.map((step, index) => <li key={index} className="flex items-start gap-2 text-xs leading-relaxed">{step.mode === 'WALK' ? <Footprints className="w-4 h-4 shrink-0 text-amber-700" /> : <Bus className="w-4 h-4 shrink-0 text-m3-primary" />}<span>{step.instruction} <span className="text-slate-500">· {plannerDistance(step.distance)}</span></span></li>)}</ol>
      </>}
    </div>}
  </motion.aside>;
}
