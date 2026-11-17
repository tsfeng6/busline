import { useEffect, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import type { CityDataset } from '../utils/cityDataset';
export function CityUploadDialog({data,busy,progress,error,onSubmit,onClose}:{data:CityDataset|null;busy:boolean;progress:number;error:string;onSubmit:(accessKey:string)=>void;onClose:()=>void}){
  const [accessKey,setAccessKey]=useState('');
  useEffect(()=>setAccessKey(''),[data]);
  if(!data)return null;
  return <div className="fixed inset-0 z-[150] bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-5">
    <section role="dialog" aria-modal="true" aria-labelledby="city-upload-title" className="w-full max-w-md rounded-3xl bg-m3-surface shadow-2xl p-7 border border-m3-outline-variant/30">
      <div className="rounded-2xl p-3 w-fit bg-m3-primary-container text-m3-primary mb-5"><Upload className="w-6 h-6" /></div>
      <h2 id="city-upload-title" className="text-xl font-bold text-slate-800">是否将此结果提交到远端？</h2>
      <p className="mt-3 text-sm text-slate-500 leading-relaxed">{data.city} · {data.lines.length} 个线路方向<br/>本地检索已完成。提交后可供其他用户查看；暂不提交也能继续使用地图。</p>
      {!data.retrievalComplete&&<p className="mt-3 text-xs text-amber-700">本次采集未完整完成，提交后可能仅保存为历史版本。</p>}
      <label className="mt-4 block text-sm font-bold text-slate-700" htmlFor="city-upload-access-key">上传密钥</label>
      <input id="city-upload-access-key" type="password" autoComplete="off" maxLength={256} value={accessKey} disabled={busy}
        onChange={event=>setAccessKey(event.target.value)} placeholder="请输入上传密钥" aria-required="true"
        className="mt-2 w-full rounded-xl border border-m3-outline-variant bg-m3-surface-container px-4 py-3 text-sm outline-none focus:border-m3-primary disabled:opacity-40" />
      <p className="mt-2 text-xs text-slate-500">上传暂时仅向持有密钥的用户开放；查看线路和本地检索不受影响。</p>
      {busy&&<p role="status" className="mt-4 text-sm text-m3-primary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/>正在上传 · {progress}%</p>}
      {error&&<p role="alert" className="mt-4 text-sm text-m3-error">{error}</p>}
      <div className="mt-7 flex justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="rounded-full px-5 py-3 text-sm font-bold text-m3-primary disabled:opacity-40">暂不提交</button>
        <button type="button" disabled={busy||!accessKey.trim()} onClick={()=>onSubmit(accessKey)} className="rounded-full px-6 py-3 text-sm font-bold bg-m3-primary text-m3-on-primary disabled:opacity-40">{busy?'提交中':'提交'}</button>
      </div>
    </section>
  </div>;
}
