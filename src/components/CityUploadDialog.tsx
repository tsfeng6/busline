import { createPortal } from 'react-dom';
import { Upload, Loader2 } from 'lucide-react';
import type { CityDataset } from '../utils/cityDataset';
export function CityUploadDialog({data,busy,progress,error,onSubmit,onClose}:{data:CityDataset|null;busy:boolean;progress:number;error:string;onSubmit:()=>void;onClose:()=>void}){
  if(!data)return null;
  return createPortal(<div className="fixed inset-0 z-[150] pointer-events-auto bg-slate-900/30 flex items-center justify-center overflow-y-auto p-5">
    <section role="dialog" aria-modal="true" aria-labelledby="city-upload-title" className="w-full max-w-md my-auto max-h-[90dvh] overflow-y-auto rounded-3xl bg-m3-surface shadow-2xl p-7 border border-m3-outline-variant/30">
      <div className="rounded-2xl p-3 w-fit bg-m3-primary-container text-m3-primary mb-5"><Upload className="w-6 h-6" /></div>
      <h2 id="city-upload-title" className="text-xl font-bold text-slate-800">是否将此结果提交到远端？</h2>
      <p className="mt-3 text-sm text-slate-500 leading-relaxed">{data.city} · {data.lines.length} 个线路方向<br/>本地检索已完成。提交后可供其他用户查看；暂不提交也能继续使用地图。</p>
      {!data.retrievalComplete&&<p className="mt-3 text-xs text-amber-700">本次检索未完整完成，提交后会显示为尚未完整的数据。</p>}
      {busy&&<p role="status" className="mt-4 text-sm text-m3-primary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/>正在上传 · {progress}%</p>}
      {error&&<p role="alert" className="mt-4 text-sm text-m3-error">{error}</p>}
      <div className="mt-7 flex justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="rounded-full px-5 py-3 text-sm font-bold text-m3-primary disabled:opacity-40">暂不提交</button>
        <button type="button" disabled={busy} onClick={onSubmit} className="rounded-full px-6 py-3 text-sm font-bold bg-m3-primary text-m3-on-primary disabled:opacity-40">{busy?'提交中':'提交'}</button>
      </div>
    </section>
  </div>, document.body);
}
