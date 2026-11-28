import { useEffect, useState } from 'react';
import { Bus, Radio } from 'lucide-react';
import {
  isFreshVehicle, VEHICLE_MAX_AGE_MS, VEHICLE_POLL_MS, type BeijingPilotResponse, type BeijingPilotRoute,
} from '../utils/beijingRealtime';

const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const markerContent = '<span style="display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#1763af;color:white;border:2px solid white;box-shadow:0 1px 4px #18283c70"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="14" rx="3"/><path d="M4 11h16M8 18v2m8-2v2M8 14h.01M16 14h.01"/></svg></span>';

export function BeijingRealtime({ route, gateway, map }: { route: BeijingPilotRoute; gateway: string; map: any }) {
  const [show, setShow] = useState(false);
  const [data, setData] = useState<BeijingPilotResponse | null>(null);

  useEffect(() => {
    if (!show) return;
    let timer: number | undefined;
    let active: AbortController | undefined;
    let disposed = false;
    const pause = () => {
      window.clearTimeout(timer);
      active?.abort();
      active = undefined;
    };
    const update = async () => {
      if (disposed || document.hidden || active) return;
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      let configured = true;
      try {
        const response = await fetch(gateway + '/transit/realtime/beijing?routeId=' + route, {
          signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw Error('Vehicle data unavailable');
        const result: BeijingPilotResponse = await response.json();
        configured = result.state !== 'unconfigured';
        if (!disposed && active === controller) setData(result);
      } catch {
        if (!disposed && active === controller) setData({ state: 'unavailable' });
      } finally {
        window.clearTimeout(timeout);
        if (!disposed && active === controller) {
          active = undefined;
          if (configured) timer = window.setTimeout(update, VEHICLE_POLL_MS);
        }
      }
    };
    const onVisibility = () => {
      pause();
      setData(null);
      if (!document.hidden) void update();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void update();
    return () => {
      disposed = true;
      pause();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [show, route, gateway]);

  useEffect(() => {
    if (!show || data?.state !== 'ready' || !map) return;
    const AMap = (window as any).AMap;
    if (!AMap) return;
    const now = Date.now();
    const vehicles = data.vehicles.filter(vehicle => isFreshVehicle(vehicle.observedAt, now));
    if (vehicles.length !== data.vehicles.length) {
      setData({ ...data, vehicles });
      return;
    }
    if (!vehicles.length) return;
    const overlays = vehicles.map(vehicle => new AMap.Marker({
        position: [vehicle.lng, vehicle.lat], anchor: 'center', content: markerContent, bubble: true,
        zIndex: 125, title: '公交车 · ' + clock.format(vehicle.observedAt),
    }));
    const nextExpiry = Math.min(...vehicles.map(vehicle => vehicle.observedAt)) + VEHICLE_MAX_AGE_MS;
    const timer = window.setTimeout(() => setData(previous => previous === data
      ? { ...data, vehicles: vehicles.filter(vehicle => isFreshVehicle(vehicle.observedAt)) }
      : previous), Math.max(1, nextExpiry - now + 1));
    map.add(overlays);
    return () => {
      window.clearTimeout(timer);
      map.remove(overlays);
    };
  }, [show, data, map]);

  const newest = data?.state === 'ready' ? Math.max(...data.vehicles.map(vehicle => vehicle.observedAt)) : -Infinity;
  const status = data?.state === 'ready'
    ? Number.isFinite(newest) ? `${data.vehicles.length} 辆 · ${clock.format(newest)}` : '暂无车辆位置'
    : data?.state === 'unconfigured' ? '试点尚未接入数据' : data?.state === 'unavailable' ? '暂时无法更新' : '正在读取…';

  return <div className="flex max-w-full flex-wrap items-center gap-x-2 text-[10px] leading-tight text-slate-600">
    <button type="button" aria-pressed={show}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-bold ${show ? 'bg-m3-primary-container text-m3-primary' : 'bg-m3-surface-container text-slate-700'}`}
      onClick={() => { setData(null); setShow(value => !value); }}>
      {show ? <Radio size={12} aria-hidden="true" /> : <Bus size={12} aria-hidden="true" />}
      实时公交
    </button>
    {show && <span className="truncate md:whitespace-normal" role="status" title={data?.state === 'ready' ? '数据来源：' + data.source : undefined}>
      {status}
      {data?.state === 'ready' && <span className="ml-1">· {data.source}</span>}
    </span>}
  </div>;
}
