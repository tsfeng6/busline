import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { X, ArrowDownUp, Copy, Plus, Loader2, Footprints, Bus, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { BusPlan, PlannerPoint, plannerBusSequence, plannerDistance, plannerPlanText, plannerTransferMarkers, plannerWalkingLabel, type PlannerMapSelection, type PlannerTransferChange } from '../utils/busPlanner';
import { loadGameCity, loadPublishedCities } from '../utils/publishedTransit';
import { plannerCityKey, plannerCorridorCities, plannerCorridorWidths, prioritizePlannerCities, preloadPlannerCities } from '../utils/plannerCityCoverage';
import { collectPlannerStations, matchPlannerStations } from '../utils/plannerStops';
import { PlannerStationField, type PlannerStationInput } from './PlannerStationField';
import { busPlanScore, combineBusPlans, hasLongWalking, LONG_WALK_WARNING, paretoBusPlans, planLongWalkingBus, planSavedBus, recommendedBusPlans, replaceShortTransferRides, transfers, type BusPlanPriority } from '../utils/savedBusPlanner';
import { estimateWalking, verifyWalking } from '../utils/plannerWalking';
import { distanceMeters } from '../utils/localTransit';
import type { BusLine } from '../types';
interface Props {
  onClose: () => void;
  hidden?: boolean;
  disabled: boolean;
  showDetails: boolean;
  currentCity: string;
  onMapPick: (handler: ((station: PlannerPoint) => void) | null) => void;
  onPreload: (active: boolean) => void;
  onSearchStart: () => void;
  mapSelection: PlannerMapSelection | null;
  onDraw: (plan: BusPlan) => void;
  onClear: () => void;
}
export function BusPlanner({ onClose, hidden, disabled, showDetails, currentCity, onMapPick, onPreload, onSearchStart, mapSelection, onDraw, onClear }: Props) {
  const initialCity = currentCity && currentCity !== '全国' ? currentCity : '北京市';
  const [origin, setOrigin] = useState<PlannerStationInput>({ city: initialCity, name: '' });
  const [destination, setDestination] = useState<PlannerStationInput>({ city: initialCity, name: '' });
  const [picking, setPicking] = useState<'起点' | '终点' | number | null>(null);
  const [waypoints, setWaypoints] = useState<{ id: number; value: PlannerStationInput }[]>([]);
  const waypointId = useRef(0);
  const waypointList = useRef<HTMLDivElement>(null);
  const scrollToNewWaypoint = useRef(false);
  useEffect(() => {
    if (!scrollToNewWaypoint.current || !waypointList.current) return;
    waypointList.current.scrollTop = waypointList.current.scrollHeight;
    scrollToNewWaypoint.current = false;
  }, [waypoints]);
  const [preciseWalking, setPreciseWalking] = useState(false);
  const [limitWalking, setLimitWalking] = useState(false);
  const [walkingKilometers, setWalkingKilometers] = useState('10');
  const walkingKm = Number(walkingKilometers);
  const validLimit = !limitWalking || (walkingKilometers.trim() !== '' && Number.isFinite(walkingKm) && walkingKm >= 0);
  const walkingLimit = limitWalking ? walkingKm * 1000 : Infinity;
  const preferredWalking = 10_000;
  const canSearch = validLimit && [origin, ...waypoints.map(point => point.value), destination]
    .every(point => point.city.trim() && point.name.trim());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [plans, setPlans] = useState<BusPlan[]>([]);
  const [selected, setSelected] = useState(0);
  const [order, setOrder] = useState<BusPlanPriority>('推荐');
  const [mobileSection, setMobileSection] = useState<'edit' | 'summary' | 'details'>('edit');
  const resultCache = useRef(new Map<BusPlanPriority, { plans: BusPlan[]; points: PlannerPoint[]; status: string }>());
  const searchKey = JSON.stringify([origin, waypoints.map(point => point.value), destination, walkingLimit, preciseWalking]);
  const lastSearchKey = useRef('');
  const verifiedWalks = useRef(new Map<string, NonNullable<Awaited<ReturnType<typeof verifyWalking>>>>());
  const displayedSearchKey = useRef('');
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
  const changeWaypoint = (id: number, value: PlannerStationInput) => {
    setWaypoints(points => points.map(point => point.id === id ? { ...point, value } : point));
  };
  const pick = (label: '起点' | '终点' | number) => {
    setPicking(label);
    onMapPick(station => {
      const value = { city: station.city, name: station.name, station };
      if (typeof label === 'number') changeWaypoint(label, value);
      else (label === '起点' ? setOrigin : setDestination)(value);
      stopPicking();
    });
  };
  useEffect(() => { if (disabled || hidden) stopPicking(); }, [disabled, hidden, stopPicking]);
  useEffect(() => () => { onMapPick(null); onPreload(false); sessionRef.current++; }, [onMapPick, onPreload]);
  const showResult = (priority: BusPlanPriority, result: { plans: BusPlan[]; points: PlannerPoint[]; status: string }) => {
    onClear();
    onDraw(result.plans[0]);
    displayedSearchKey.current = searchKey;
    setResolved(result.points);
    setPlanPoints(result.points);
    setPlans(result.plans);
    setSelected(0);
    setOrder(priority);
    setStatus(result.status);
    setCopyState('idle');
    setMobileSection('summary');
  };
  const search = async (priority: BusPlanPriority = '推荐') => {
    if (busy || disabled || hidden || picking !== null || !canSearch) return;
    const AMap = (window as any).AMap;
    if (!AMap) { setError('地图服务尚未就绪，请稍后重试。'); return; }
    const session = ++sessionRef.current;
    const isCurrent = () => session === sessionRef.current;
    onSearchStart();
    if (lastSearchKey.current !== searchKey) {
      resultCache.current.clear();
      verifiedWalks.current = new Map();
      lastSearchKey.current = searchKey;
    }
    const cached = resultCache.current.get(priority);
    if (cached) {
      try { showResult(priority, cached); setError(''); return; }
      catch { resultCache.current.delete(priority); }
    }
    setBusy(true); setError(''); setResolved([]);
    const pointCache = new Map<string, PlannerPoint>();
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
    const verifiedWalkCache = verifiedWalks.current;
    const trySavedConnection = async (from: PlannerPoint, to: PlannerPoint, remainingWalking: number, onCandidates: () => void) => {
      const resolveWalking = preciseWalking ? (start: PlannerPoint['location'], end: PlannerPoint['location']) => {
        const key = `${start.join(',')}>${end.join(',')}`;
        const verified = verifiedWalkCache.get(key);
        if (verified) return Promise.resolve(verified);
        const cached = walkingCache.get(key);
        if (cached) return cached;
        if (!AMap.Walking) return Promise.resolve(null);
        const pending = verifyWalking(AMap, start, end, 8_000).then(step => {
          if (step) {
            verifiedWalkCache.set(key, step);
            if (verifiedWalkCache.size > 256) verifiedWalkCache.delete(verifiedWalkCache.keys().next().value!);
          }
          return step;
        });
        walkingCache.set(key, pending);
        return pending;
      } : estimateWalking;
      setStatus('正在查找沿途已收录线网…');
      const { cities: catalog, failed } = await catalogTask;
      catalogFailed ||= failed;
      const attempted = new Set<string>();
      let corridorLines: BusLine[] = [];
      let knownPlans: BusPlan[] = [];
      // A high-transfer result is still available, but warrants searching the
      // wider corridor for a more practical route before returning it.
      const typicalTransfers = 4 + Math.ceil(distanceMeters(from.location, to.location) / 30_000);
      const simplify = async (candidates: BusPlan[]) => {
        if (priority !== '推荐') return candidates;
        const services = new Map<string, BusLine[]>();
        for (const line of corridorLines) {
          const matching = services.get(line.name) ?? [];
          matching.push(line);
          services.set(line.name, matching);
        }
        const simplified: BusPlan[] = [];
        for (const plan of candidates) {
          check();
          simplified.push(await replaceShortTransferRides(plan, remainingWalking, resolveWalking, () => !isCurrent(), services));
        }
        return paretoBusPlans(simplified);
      };
      const onWalking = () => {
        if (preciseWalking) setStatus('正在核验步行接驳…');
        onCandidates();
      };
      for (const radius of plannerCorridorWidths(from, to)) {
        check();
        const pendingCities = plannerCorridorCities(catalog, from, to, radius).filter(city => !attempted.has(plannerCityKey(city)));
        if (!pendingCities.length) continue;
        onPreload(true);
        try {
          setStatus('正在确认沿途城市…');
          const cities = await prioritizePlannerCities(AMap, pendingCities, from, to, () => !isCurrent());
          check();
          const loaded = await preloadPlannerCities(cities, readCity, () => !isCurrent(),
            completed => setStatus(`正在预载沿途线网（${completed}/${cities.length}）…`));
          check();
          const added = loaded.flatMap(({ city, data }) => {
            attempted.add(plannerCityKey(city));
            if (data) return data.lines;
            unavailableCities.add(city);
            return [];
          });
          if (!added.length) continue;
          corridorLines = [...corridorLines, ...added];
        } finally {
          if (isCurrent()) onPreload(false);
        }
        check();
        setStatus('正在比较换乘次数与步行距离…');
        const results = await planSavedBus(corridorLines, from, to, priority === '推荐' ? Math.min(preferredWalking, remainingWalking) : remainingWalking, resolveWalking, () => !isCurrent(), onWalking, priority);
        knownPlans = paretoBusPlans([...knownPlans, ...results]);
        if (knownPlans.some(plan => priority === '少换乘' ? transfers(plan) === 0 && (!Number.isFinite(walkingLimit) || !waypoints.length || plan.walking === 0)
          : priority === '少步行' ? plan.walking === 0
          : !hasLongWalking(plan, preferredWalking) && transfers(plan) <= typicalTransfers)) return simplify(knownPlans);
      }
      setStatus('正在搜索周边城市的长距离接驳…');
      const baseline = [...knownPlans].sort(comparePlans(priority))[0];
      const alternatives = await planLongWalkingBus(corridorLines, from, to, resolveWalking, () => !isCurrent(), onWalking, baseline, remainingWalking, priority);
      return simplify(paretoBusPlans([...knownPlans, ...alternatives]));
    };
    try {
      const requests = [...waypoints.map(point => point.value), destination];
      setStatus('正在确认公交站点…');
      let from = await locate(origin);
      const verifiedPoints = [from];
      let combined = [empty];
      for (const [index, request] of requests.entries()) {
        setStatus(`正在确认第 ${index + 1}/${requests.length} 段的到达站…`);
        const to = await locate(request);
        verifiedPoints.push(to);
        setResolved([...verifiedPoints]);
        if (from.location[0] === to.location[0] && from.location[1] === to.location[1]) {
          from = to;
          continue;
        }
        const remainingWalking = walkingLimit - combined.reduce((best, plan) => Math.min(best, plan.walking), Infinity);
        let hadCandidates = false;
        const savedPlans = await trySavedConnection(from, to, remainingWalking, () => { hadCandidates = true; });
        check();
        if (!savedPlans.length) {
          const reason = catalogFailed || unavailableCities.size
            ? '部分沿途线网暂时无法读取。'
            : limitWalking
              ? preciseWalking ? '未找到符合剩余步行上限且通过道路核验的方案。' : '未找到符合剩余步行上限的方案。'
              : preciseWalking && hadCandidates
                ? '部分道路接驳未能核验，暂时无法组成完整方案。'
                : '沿途和周边已收录的公交线路暂时无法接续。';
          throw new Error(`${from.name} → ${to.name}：${reason}`);
        }
        combined = combineBusPlans(combined, savedPlans, walkingLimit);
        from = to;
      }
      if (!combined.some(plan => plan.buses > 0)) throw new Error('请至少选择两个位置不同的公交站。');
      check();
      const result = {
        plans: priority === '推荐' ? recommendedBusPlans(combined) : [...combined].sort(comparePlans(priority)),
        points: verifiedPoints,
        status: catalogFailed || unavailableCities.size
          ? '已找到方案，部分沿途线网暂时无法读取。' : '已找到基于 Busline 收录线网的方案。',
      };
      showResult(priority, result);
      resultCache.current.set(priority, result);
    } catch (e: any) { if (isCurrent()) { setError(e.message || '规划失败，请重试。'); setStatus(''); } }
    finally { if (isCurrent()) setBusy(false); }
  };
  const cancel = () => {
    sessionRef.current++;
    onPreload(false);
    setBusy(false);
    setStatus('已取消规划。');
  };
  const field = 'w-full rounded-lg bg-m3-surface-container/75 px-2 py-2.5 text-xs outline-none focus:ring-1 focus:ring-m3-primary';
  const selectedPlan = plans[selected];
  const resultPanel = useRef<HTMLDivElement>(null);
  const transferRows = useMemo(() => {
    const rows = new Map<number, { index: number; changes: PlannerTransferChange[] }[]>();
    plannerTransferMarkers(selectedPlan?.steps ?? []).forEach(({ changes }, index) => {
      const at = changes[0].stepIndex;
      const row = { index, changes };
      const existing = rows.get(at);
      if (existing) existing.push(row);
      else rows.set(at, [row]);
    });
    return rows;
  }, [selectedPlan]);
  useEffect(() => {
    if (mapSelection && !hidden && picking === null) setMobileSection('details');
  }, [mapSelection, hidden, picking]);
  useEffect(() => {
    if (!mapSelection || mobileSection !== 'details' || hidden || picking !== null) return;
    const panel = resultPanel.current;
    const row = panel?.querySelector('[data-map-selected="true"]');
    if (panel && row) {
      const offset = row.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      panel.scrollTop += offset - 12;
    }
  }, [mapSelection, mobileSection, hidden, picking]);
  const visibleStatus = busy && !showDetails ? '正在加载中…' : status;
  const selectPlan = (index: number) => {
    try { onDraw(plans[index]); setSelected(index); setCopyState('idle'); }
    catch { setError('地图状态已改变，请重新规划。'); }
  };
  const copyPlan = async () => {
    if (!selectedPlan) return;
    try {
      await navigator.clipboard.writeText(plannerPlanText(selectedPlan, planPoints));
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  };
  if (hidden) return null;
  return <motion.aside initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }}
    aria-label="公交路线规划" className="fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:left-4 sm:top-20 sm:bottom-auto z-[75] sm:w-[400px] max-h-[52dvh] sm:max-h-[calc(100dvh-9rem)] flex flex-col gap-2 pointer-events-none">
    <div className={`pointer-events-auto rounded-2xl bg-m3-surface border border-m3-outline-variant/50 shadow-lg ${mobileSection !== 'edit' && picking === null ? 'hidden sm:block' : ''}`}>
    <div className="flex justify-between items-center gap-2 px-4 py-2 border-b border-m3-outline-variant/30">
      <h2 className="text-sm font-black text-m3-primary flex items-center gap-2"><Bus className="w-4 h-4" />公交规划</h2>
      {selectedPlan && picking === null && <button type="button" disabled={busy} onClick={() => setMobileSection('summary')} className="ml-auto px-2 py-1 text-xs font-bold text-m3-primary sm:hidden">查看方案</button>}
      <button onClick={() => { stopPicking(); onClose(); }} aria-label="关闭公交规划" className="p-2 rounded-full hover:bg-m3-primary/10"><X className="w-4 h-4" /></button>
    </div>
    {picking !== null && <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
      <p role="status">放大地图后点击公交站圆点，设为{typeof picking === 'number' ? '途经站' : picking}。</p>
      <button type="button" className="shrink-0 font-bold text-m3-primary" onClick={stopPicking}>取消选站</button>
    </div>}
      <form hidden={picking !== null} onSubmit={event => { event.preventDefault(); void search(); }} className="space-y-2 px-3 py-3 max-h-[calc(52dvh-3rem)] sm:max-h-[min(36dvh,19rem)] overflow-y-auto">
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || disabled} aria-label="交换起点与终点" title="交换起点与终点"
            onClick={() => { setOrigin(destination); setDestination(origin); setWaypoints(points => [...points].reverse()); }} className="shrink-0 rounded-full p-1.5 text-m3-primary hover:bg-m3-primary-container disabled:opacity-40"><ArrowDownUp className="h-4 w-4" /></button>
          <div className="min-w-0 flex-1 space-y-1.5">
            <PlannerStationField label="起点" value={origin} onChange={setOrigin} load={loadStations} onPick={() => pick('起点')} disabled={busy || disabled} fieldClassName={field} />
            {waypoints.length > 0 && <div ref={waypointList} role="region" aria-label="途经站列表" tabIndex={0}
              className="max-h-[clamp(3.25rem,12dvh,6rem)] space-y-1.5 overflow-y-auto overscroll-contain rounded-lg pr-1 custom-scrollbar">
            {waypoints.map(({ id, value }, index) => <div key={id} className="rounded-xl border border-m3-outline-variant/40 px-2 pb-2">
              <div className="flex items-center justify-between py-1 text-xs font-bold text-m3-primary">
                <span>途经站 {index + 1}</span>
                <button type="button" disabled={busy || disabled} aria-label={`移除途经站 ${index + 1}`} onClick={() => setWaypoints(points => points.filter(point => point.id !== id))}
                  className="rounded-full px-2 py-0.5 text-xs hover:bg-m3-primary-container disabled:opacity-40">移除</button>
              </div>
              <PlannerStationField label={`途经站 ${index + 1}`} value={value} onChange={station => changeWaypoint(id, station)}
                load={loadStations} onPick={() => pick(id)} disabled={busy || disabled} fieldClassName={field} />
            </div>)}
            </div>}
            <PlannerStationField label="终点" value={destination} onChange={setDestination} load={loadStations} onPick={() => pick('终点')} disabled={busy || disabled} fieldClassName={field} />
          </div>
        </div>
        <button type="button" disabled={busy || disabled} onClick={() => {
          const id = ++waypointId.current;
          scrollToNewWaypoint.current = true;
          setWaypoints(points => [...points, { id, value: { city: points.at(-1)?.value.city || origin.city, name: '' } }]);
        }} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-m3-primary hover:bg-m3-primary-container disabled:opacity-40">
          <Plus className="h-4 w-4" />添加途经站
        </button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-700">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={preciseWalking} disabled={busy} onChange={event => setPreciseWalking(event.target.checked)} className="accent-m3-primary" />精确步行走向</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={limitWalking} disabled={busy} onChange={event => setLimitWalking(event.target.checked)} className="accent-m3-primary" />限制总步行距离</label>
          {limitWalking && <label className="flex items-center gap-1.5"><input aria-label="总步行上限（公里）" type="number" min={0} step="any" disabled={busy} required value={walkingKilometers}
            onChange={event => setWalkingKilometers(event.target.value)} className="w-24 rounded-lg border border-m3-outline-variant px-2 py-1" />公里</label>}
        </div>
        {busy && <p role="status" className="text-xs text-m3-primary sm:hidden">{visibleStatus}</p>}
        {error && <p role="alert" className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900 sm:hidden">{error}</p>}
        {busy ? <button type="button" onClick={cancel} className="w-full rounded-xl border border-m3-outline-variant/50 py-2.5 flex items-center justify-center gap-2 text-xs font-bold text-m3-primary"><Loader2 className="w-4 h-4 animate-spin" />取消规划</button>
          : <button type="submit" disabled={disabled || !canSearch} className="w-full rounded-xl bg-m3-primary text-white py-2.5 flex items-center justify-center gap-2 text-xs font-bold disabled:opacity-40"><Search className="w-4 h-4" />开始公交规划</button>}
      </form>
    </div>
    {picking === null && (visibleStatus || error || selectedPlan) && <div ref={resultPanel} className={`pointer-events-auto min-h-0 overflow-y-auto custom-scrollbar rounded-2xl bg-m3-surface border border-m3-outline-variant/50 shadow-lg p-3 space-y-2 ${mobileSection === 'edit' ? 'hidden sm:block' : ''}`}>
      {selectedPlan && mobileSection !== 'edit' && <div className="flex items-center justify-between gap-2 sm:hidden">
        <button type="button" disabled={busy} onClick={() => setMobileSection('edit')} className="rounded-lg px-2 py-1 text-xs font-bold text-m3-primary disabled:opacity-50">修改站点</button>
        <div className="flex items-center gap-1">
          <button type="button" aria-expanded={mobileSection === 'details'} onClick={() => setMobileSection(mobileSection === 'details' ? 'summary' : 'details')} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-m3-primary">
            {mobileSection === 'details' ? <><ChevronDown className="h-4 w-4" />收起</> : <><ChevronUp className="h-4 w-4" />展开</>}
          </button>
          <button type="button" onClick={onClose} aria-label="关闭公交规划" className="rounded-full p-1.5"><X className="h-4 w-4" /></button>
        </div>
      </div>}
      {busy && mobileSection !== 'edit' && <button type="button" onClick={cancel} className="text-xs text-m3-primary sm:hidden">取消规划</button>}
      {visibleStatus && <p role="status" className={`text-xs text-m3-primary ${!busy && selectedPlan ? 'hidden sm:block' : ''}`}>{visibleStatus}</p>}
      {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 whitespace-pre-wrap leading-relaxed">{error}</p>}
      {showDetails && !selectedPlan && resolved.length > 0 && <div className="text-[10px] text-slate-500">已定位：{resolved.map(point => `${point.city}·${point.name}`).join(' → ')}</div>}
      {selectedPlan && <>
        <div aria-label="规划偏好" className="flex gap-1 rounded-xl bg-m3-surface-container p-1">
          {(['推荐', '少换乘', '少步行'] as const).map(option => <button key={option} type="button" disabled={busy || disabled || searchKey !== displayedSearchKey.current} aria-pressed={order === option} onClick={() => {
            if (order !== option) void search(option);
          }}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${order === option ? 'bg-m3-surface text-m3-primary shadow-sm' : 'text-slate-600'}`}>{option}</button>)}
        </div>
        <div className="space-y-1.5">{plans.map((plan, index) => <button key={index} type="button" aria-pressed={selected === index} onClick={() => selectPlan(index)} className={`w-full rounded-xl border px-3 py-2.5 text-left ${selected !== index && mobileSection !== 'details' ? 'hidden sm:block' : 'block'} ${selected === index ? 'border-m3-primary/50 bg-m3-primary-container/55' : 'border-m3-outline-variant/40 hover:bg-m3-surface-container'}`}>
          <span className="line-clamp-1 sm:line-clamp-3 text-sm font-bold text-m3-primary">{plannerBusSequence(plan)}</span>
          <span className="mt-1 block text-xs text-slate-600">{plannerDistance(plan.distance)} · 换乘 {transfers(plan)} 次 · {plannerWalkingLabel(plan)} {plannerDistance(plan.walking)}</span>
          {hasLongWalking(plan, preferredWalking) && <span className="mt-1 block text-[11px] text-amber-800">{LONG_WALK_WARNING}</span>}
        </button>)}</div>
        <div className={`space-y-3 ${mobileSection !== 'details' ? 'hidden sm:block' : ''}`}>
          <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold">行程详情</h3>
          <button type="button" onClick={() => void copyPlan()} className="flex items-center gap-1 rounded-lg bg-m3-primary-container px-2.5 py-1.5 text-xs font-bold text-m3-primary"><Copy className="h-3.5 w-3.5" />{copyState === 'copied' ? '已复制' : '复制方案'}</button></div>
        {copyState === 'manual' && <textarea aria-label="方案文本，选中后复制" readOnly rows={5} value={plannerPlanText(selectedPlan, planPoints)} onFocus={event => event.currentTarget.select()} className={field} />}
        <ol className="space-y-2 border-l border-m3-outline-variant/45 pl-3">
          {selectedPlan.steps.map((step, index) => {
            const selectedStep = mapSelection?.kind === 'step' && mapSelection.indices.includes(index);
            return <li key={index} className="space-y-1.5 text-xs leading-relaxed">
              {transferRows.get(index)?.map(marker => {
                const selectedMarker = mapSelection?.kind === 'transfer' && mapSelection.index === marker.index;
                return <div key={marker.index} data-map-selected={selectedMarker} aria-current={selectedMarker || undefined}
                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${selectedMarker ? 'bg-red-100 ring-1 ring-red-400' : 'text-slate-600'}`}>
                  <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-600" />
                  <div><strong>换乘点 {marker.index + 1}</strong>
                    {selectedMarker && <span className="ml-2 rounded bg-red-200 px-1.5 py-0.5 font-bold text-red-950">地图选中</span>}
                    {marker.changes.map(change => <div key={`${change.stepIndex}:${change.label}`}>
                      第 {change.stepIndex} 段 → 第 {change.stepIndex + 1} 段 · {change.stopName ? `${change.stopName} · ` : ''}{change.label}
                    </div>)}
                  </div>
                </div>;
              })}
              <div data-map-selected={selectedStep} aria-current={selectedStep || undefined}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${selectedStep ? 'bg-amber-100 ring-1 ring-amber-400' : ''}`}>
                {step.mode === 'WALK' ? <Footprints className="h-4 w-4 shrink-0 text-amber-700" /> : <Bus className="h-4 w-4 shrink-0 text-m3-primary" />}
                <span><strong className="mr-1.5">第 {index + 1} 段</strong>
                  {selectedStep && <span className="mr-1.5 rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-950">地图选中</span>}
                  {step.instruction} <span className="text-slate-500">· {plannerDistance(step.distance)}</span></span>
              </div>
            </li>;
          })}
        </ol>
        </div>
      </>}
    </div>}
  </motion.aside>;
}

function comparePlans(priority: BusPlanPriority) {
  return (a: BusPlan, b: BusPlan) => priority === '少换乘'
    ? transfers(a) - transfers(b) || a.walking - b.walking || a.distance - b.distance
    : priority === '少步行'
      ? a.walking - b.walking || transfers(a) - transfers(b) || a.distance - b.distance
      : busPlanScore(a) - busPlanScore(b);
}
