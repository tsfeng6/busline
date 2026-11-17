import React, { useState } from 'react';
import { Upload, History, Loader2, RefreshCw, X } from 'lucide-react';
import type { CityDataset, CitySnapshotMeta } from '../utils/cityDataset';
import { listSharedCityHistory, sharedCityDataEnabled } from '../utils/sharedCityClient';

export function CityDataPanel({ data, status, onRefresh, onUpload }: { data: CityDataset | null; status: string; onRefresh?: () => void; onUpload?: () => void }) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<CitySnapshotMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const showHistory = async () => {
    if (!data) return;
    setOpen(true); setBusy(true); setError(''); setRecords([]);
    try { setRecords(await listSharedCityHistory(data.city)); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-m3-outline-variant/40 p-4 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div><h3 className="text-sm font-bold text-slate-800">城市线路数据</h3>
        <p className="text-xs text-slate-500 mt-1">{status || '全市检索后可查看城市线路数据及更新记录。'}</p></div>
      <div className="flex gap-2 shrink-0">
        {onUpload && <button type="button" aria-label="提交当前结果到远端" title="提交当前结果到远端" onClick={onUpload} className="p-2 rounded-full bg-m3-primary-container text-m3-on-primary-container"><Upload className="w-5 h-5" /></button>}
        {onRefresh && <button type="button" aria-label="重新检索并更新城市快照" title="重新检索并更新城市快照" disabled={!data} onClick={onRefresh}
          className="p-2 rounded-full bg-m3-primary-container text-m3-on-primary-container disabled:opacity-35"><RefreshCw className="w-5 h-5" /></button>}
        <button type="button" aria-label="查看城市线路历史" title="查看城市线路历史" disabled={!data || !sharedCityDataEnabled}
          onClick={showHistory} className="p-2 rounded-full bg-m3-primary-container text-m3-on-primary-container disabled:opacity-35"><History className="w-5 h-5" /></button>
      </div>
    </div>
    {data && <p className="text-xs text-slate-500">{data.city} · {data.lines.length} 个线路方向 · {new Date(data.capturedAt).toLocaleString('zh-CN')}</p>}
    {open && <div role="dialog" aria-modal="true" aria-label="城市线路历史" className="fixed inset-0 z-[150] bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-m3-surface rounded-3xl p-5 w-full max-w-lg max-h-[75vh] overflow-auto shadow-xl">
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold">{data?.city} · 历史快照</h3><button aria-label="关闭城市线路历史" onClick={() => setOpen(false)}><X className="w-5 h-5" /></button></div>
        {busy && <Loader2 className="w-5 h-5 animate-spin" />}
        {error && <p className="text-sm text-m3-error">{error}</p>}
        {!busy && !error && !records.length && <p className="text-sm text-slate-500">暂无历史快照。</p>}
        {records.map(record => <div key={record.id} className="flex items-center justify-between border-b border-m3-outline-variant/30 py-3 gap-3">
          <div className="text-xs"><p className="font-bold">{new Date(record.capturedAt).toLocaleString('zh-CN')}</p><p className="text-slate-500 mt-1">{record.lineDirections} 个方向 · {record.promoted ? '已发布' : '仅保留历史'}</p></div>
        </div>)}
      </div>
    </div>}
  </section>;
}
