import React from 'react';
import { Pause, Play, X } from 'lucide-react';
import { formatTimelineMinute } from '../utils/timeline';
export function TimelineBar({ minute, onChange, onClose, onTogglePlayback, playing, active, total }: {
  minute: number; onChange: (value: number) => void; onClose: () => void; onTogglePlayback: () => void; playing: boolean; active: number; total: number;
}) {
  return <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-[min(640px,calc(100vw-32px))] rounded-3xl bg-m3-surface/95 backdrop-blur-xl border border-m3-outline-variant/40 shadow-xl px-5 py-3 pointer-events-auto">
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2"><button type="button" onClick={onTogglePlayback} aria-label={playing ? '暂停时间轴' : '播放时间轴'} title={playing ? '暂停' : '播放'} className="p-1.5 rounded-full hover:bg-m3-primary/10 text-m3-primary">{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button><div className="flex items-baseline gap-2"><strong className="text-lg tabular-nums text-m3-primary">{formatTimelineMinute(minute)}</strong><span className="text-xs text-slate-500">运营中 {active}/{total} 个方向</span></div></div>
      <button type="button" onClick={onClose} aria-label="退出时间轴" className="p-1.5 rounded-full hover:bg-m3-primary/10"><X className="w-4 h-4" /></button>
    </div>
    <input type="range" min={0} max={1439} step={1 / 3} value={minute} onChange={event => onChange(Number(event.target.value))}
      aria-label="线路运营时间轴" aria-valuetext={formatTimelineMinute(minute)} className="w-full accent-m3-primary cursor-ew-resize h-5" />
    <div className="flex justify-between text-[10px] text-slate-500 tabular-nums"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span></div>
    <p className="mt-1.5 text-[10px] text-slate-500">按始发站首末班时间估算，非实时到站。</p>
  </div>;
}
