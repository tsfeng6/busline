import React from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { CityUpdateJob } from '../utils/cityUpdateJobs';
export function CityUpdateStatus({job,onClose}:{job:CityUpdateJob|null;onClose:()=>void}) {
  if(!job)return null;
  const pending=job.state==='queued'||job.state==='running';
  return <div role="status" className="absolute top-24 left-4 sm:left-6 z-30 max-w-sm rounded-2xl bg-m3-surface/95 border border-m3-outline-variant/40 p-4 shadow-lg flex items-center gap-3">
    {pending?<Loader2 className="w-5 h-5 shrink-0 animate-spin text-m3-primary"/>:job.state==='completed'||job.state==='ready'?<Check className="w-5 h-5 shrink-0 text-m3-primary"/>:null}
    <div className="text-xs text-slate-600"><p className="font-bold text-slate-800 mb-1">{job.city}</p><p>{job.message}</p>
      {pending&&<p className="mt-1 text-slate-400">可以继续浏览，线路更新完成后自动加载。</p>}</div>
    <button aria-label="关闭城市更新状态" title={pending?'关闭提示，任务仍在后台继续':'关闭提示'} className="text-slate-400" onClick={onClose}><X className="w-4 h-4"/></button>
  </div>;
}
