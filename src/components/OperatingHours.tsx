import React from 'react';
import { formatOperatingTime } from '../utils/operatingHours';
export function OperatingHours({ first, last, description }: { first?: unknown; last?: unknown; description?: string }) {
  const start = formatOperatingTime(first), end = formatOperatingTime(last);
  return <div className="shrink-0 ml-auto text-right text-[10px] leading-relaxed tabular-nums text-slate-500" title={description || '该方向始发站首末班发车时间，以公交运营方公告为准'}>
    {start || end ? <><div>首班 <span className="font-bold text-m3-primary">{start || '暂无'}</span></div><div>末班 <span className="font-bold text-slate-700">{end || '暂无'}</span></div></> : <span className="text-slate-400">{description ? '分日期运营' : '暂无时间'}</span>}
  </div>;
}
