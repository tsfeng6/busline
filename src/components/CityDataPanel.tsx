import React, { useState } from 'react';
import { Download, History, Loader2, RefreshCw, X } from 'lucide-react';
import type { CityDataset, CitySnapshotMeta } from '../utils/cityDataset';
import { exportCityJSON, listSharedCityHistory, loadHistoricalCity, sharedCityDataEnabled } from '../utils/sharedCityClient';

export function CityDataPanel({ data, status, onRefresh }: { data: CityDataset | null; status: string; onRefresh?: () => void }) {
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
        <p className="text-xs text-slate-500 mt-1">{status || '全市检索后可导出本次线路 JSON。'}</p></div>
      <div className="flex gap-2 shrink-0">
        {onRefresh && <button type="button" aria-label="重新检索并更新城市快照" title="重新检索并更新城市快照" disabled={!data} onClick={onRefresh}
          className="p-2 rounded-full bg-m3-primary-container text-m3-on-primary-container disabled:opacity-35"><RefreshCw className="w-5 h-5" /></button>}
        <button type="button" aria-label="导出当前城市线路 JSON" title="导出当前城市线路 JSON" disabled={!data}
          onClick={() => data && exportCityJSON(data)} className="p-2 rounded-full bg-m3-primary-container text-m3-on-primary-container disabled:opacity-35"><Download className="w-5 h-5" /></button>
        <button type="button" aria-label="查看城市线路历史" title="查看城市线路历史" disabled={!data || !sharedCityDataEnabled}
          onClick={showHistory} className="p-2 rounded-full bg-m3-primary-container text-m3-on-primary-container disabled:opacity-35"><History className="w-5 h-5" /></button>
      </div>
    </div>
    {data && <p className="text-xs text-slate-500">{data.city} · {data.lines.length} 个线路方向 · {new Date(data.capturedAt).toLocaleString('zh-CN')}<br />本次成功获取的线路，不代表已核实全市全部线路。</p>}
    {open && <div role="dialog" aria-modal="true" aria-label="城市线路历史" className="fixed inset-0 z-[150] bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-m3-surface rounded-3xl p-5 w-full max-w-lg max-h-[75vh] overflow-auto shadow-xl">
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold">{data?.city} · 历史快照</h3><button aria-label="关闭城市线路历史" onClick={() => setOpen(false)}><X className="w-5 h-5" /></button></div>
        {busy && <Loader2 className="w-5 h-5 animate-spin" />}
        {error && <p className="text-sm text-m3-error">{error}</p>}
        {!busy && !error && !records.length && <p className="text-sm text-slate-500">暂无历史快照。</p>}
        {records.map(record => <div key={record.id} className="flex items-center justify-between border-b border-m3-outline-variant/30 py-3 gap-3">
          <div className="text-xs"><p className="font-bold">{new Date(record.capturedAt).toLocaleString('zh-CN')}</p><p className="text-slate-500 mt-1">{record.lineDirections} 个方向 · {record.promoted ? '已发布' : '仅保留历史'}</p></div>
          <button aria-label={`下载 ${record.capturedAt} 快照`} disabled={busy} className="p-2 text-m3-primary" onClick={async () => {
            setBusy(true); setError('');
            try { exportCityJSON(await loadHistoricalCity(data!.city, record.id)); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
          }}><Download className="w-5 h-5" /></button>
        </div>)}
      </div>
    </div>}
  </section>;
}
