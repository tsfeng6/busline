import React from 'react';
import { formatOperatingTime, operatingHoursRows } from '../utils/operatingHours';

export function OperatingHours({ first, last, description }: { first?: unknown; last?: unknown; description?: string }) {
  const start = formatOperatingTime(first), end = formatOperatingTime(last);
  const rows = operatingHoursRows(description);
  const remark = description?.includes('分日期运营') ? undefined : description?.trim();
  return (
    <div className="ml-auto max-w-[120px] text-right text-[10px] leading-relaxed tabular-nums text-slate-500 md:max-w-44"
      title={remark || '该方向始发站首末班发车时间，以公交运营方公告为准'}>
      {rows.length ? rows.map((row, index) => <div className="break-words" key={index}>{row}</div>)
        : start || end ? <>
          <div>首班 <span className="font-bold text-m3-primary">{start || '暂无'}</span></div>
          <div>末班 <span className="font-bold text-slate-700">{end || '暂无'}</span></div>
        </> : <span className="line-clamp-2 text-slate-400">{remark || '暂无时间'}</span>}
    </div>
  );
}
