import { useEffect, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import type { PlannerPoint } from '../utils/busPlanner';
import { matchPlannerStations, type PlannerStation } from '../utils/plannerStops';

export type PlannerStationInput = { city: string; name: string; station?: PlannerPoint };

type Props = {
  label: string;
  value: PlannerStationInput;
  onChange: (value: PlannerStationInput) => void;
  load: (city: string) => Promise<PlannerStation[]>;
  onPick: () => void;
  disabled: boolean;
  fieldClassName: string;
};

export function PlannerStationField({ label, value, onChange, load, onPick, disabled, fieldClassName }: Props) {
  const [focused, setFocused] = useState(false);
  const optionsRef = useRef<HTMLUListElement>(null);
  const [result, setResult] = useState<{ city: string; stations: PlannerStation[]; failed: boolean }>();
  const city = value.city.trim();
  const showSuggestions = focused && !disabled && Boolean(city && value.name.trim()) && !value.station;
  useEffect(() => {
    if (!showSuggestions) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void load(city).then(stations => {
        if (!cancelled) setResult({ city, stations, failed: false });
      }, () => {
        if (!cancelled) setResult({ city, stations: [], failed: true });
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [showSuggestions, city, load]);
  const matches = showSuggestions && result?.city === city ? matchPlannerStations(result.stations, value.name).slice(0, 8) : [];

  return <div className="space-y-1.5" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }}>
    <div className="grid grid-cols-[10px_62px_minmax(0,1fr)_auto_auto] items-center gap-1.5 sm:grid-cols-[10px_80px_minmax(0,1fr)_auto_auto]">
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full border-2 ${label === '起点' ? 'border-emerald-500' : label === '终点' ? 'border-red-500' : 'border-amber-500'}`} />
      <input aria-label={`${label}城市`} placeholder="城市" disabled={disabled} className={fieldClassName}
        value={value.city} onChange={event => onChange({ city: event.target.value, name: value.name })} />
      <input aria-label={`${label}公交站`} placeholder={`输入${label}公交站名`} disabled={disabled} className={fieldClassName}
        value={value.name} autoComplete="off" onFocus={() => setFocused(true)}
        onChange={event => { setFocused(true); onChange({ city: value.city, name: event.target.value }); }}
        onKeyDown={event => {
          if (event.key === 'Escape') setFocused(false);
          if (event.key === 'ArrowDown' && matches.length) {
            event.preventDefault();
            optionsRef.current?.querySelector('button')?.focus();
          }
        }} />
      <button type="button" disabled={disabled || !value.name} aria-label={`清空${label}`} onClick={() => onChange({ city: value.city, name: '' })}
        className="p-1 text-slate-500 disabled:invisible"><X className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={disabled} onClick={() => { setFocused(false); onPick(); }}
        aria-label={`在地图上选择${label}公交站`} title="地图选站"
        className="flex items-center gap-1 rounded-xl border border-m3-outline-variant/50 px-2 text-xs font-bold text-m3-primary hover:bg-m3-primary-container disabled:opacity-50">
        <MapPin className="h-4 w-4" />
      </button>
    </div>
    {showSuggestions && (matches.length ? <ul ref={optionsRef} aria-label={`${label}公交站建议`} className="max-h-40 overflow-y-auto rounded-xl border border-m3-outline-variant/30 bg-m3-surface">
      {matches.map(station => <li key={`${station.name}|${station.location.join(',')}`}>
        <button type="button" onClick={() => { onChange({ city: station.city, name: station.name, station }); setFocused(false); }}
          className="block w-full px-3 py-2 text-left text-xs hover:bg-m3-primary-container focus:bg-m3-primary-container">
          <span className="font-bold">{station.name}</span>
          <span className="ml-2 text-slate-500">{station.routes.slice(0, 4).join('、')}</span>
        </button>
      </li>)}
    </ul> : <p role="status" className="px-1 text-[11px] text-slate-500">
      {result?.city !== city ? '正在读取公交站点…' : result.failed ? '暂时无法读取该城市的公交站点。' : '未找到匹配的公交站。'}
    </p>)}
  </div>;
}
