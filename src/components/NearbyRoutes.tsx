import {Loader2,MapPin,X} from 'lucide-react';
import type {BusLine} from '../types';
import {routeName} from '../utils/localTransit';
export type NearbyState={status:'locating'|'loading'|'ready'|'denied'|'missing'|'error';lines:{city:string;line:BusLine;distance:number}[];message?:string;accuracy?:number};
export function NearbyRoutes({state,onClose,onSelect,onRetry}:{state:NearbyState;onClose:()=>void;onSelect:(line:BusLine)=>void;onRetry:()=>void}){
 return <section role="region" aria-label="附近500米公交线路" className="fixed top-40 left-4 sm:left-6 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-3xl bg-m3-surface/95 border border-m3-outline-variant/40 p-5 shadow-xl pointer-events-auto">
  <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-m3-primary"><MapPin className="w-4 h-4"/><span className="text-[10px] font-bold">附近 500 米</span></div><h2 className="mt-2 text-sm font-bold text-slate-800">您附近有这些线路经过</h2></div><button type="button" aria-label="关闭附近线路" onClick={onClose} className="p-1 text-slate-400"><X className="w-4 h-4"/></button></div>
  {(state.status==='locating'||state.status==='loading')&&<p role="status" className="mt-4 flex gap-2 items-center text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin"/>{state.status==='locating'?'正在获取您的位置…':'正在读取附近的已保存线路…'}</p>}
  {state.status==='ready'&&<><p className="mt-2 text-[10px] text-slate-500">来自网站已有数据 · {state.lines.length} 条线路</p><div className="mt-3 max-h-[45dvh] overflow-y-auto space-y-1">{state.lines.map(item=><button key={`${item.city}:${routeName(item.line.name)}`} type="button" onClick={()=>onSelect(item.line)} className="w-full text-left rounded-xl px-3 py-2 hover:bg-m3-primary-container/50 flex justify-between items-center gap-3"><span><span className="block text-xs font-bold text-m3-primary">{routeName(item.line.name)}</span><span className="text-[10px] text-slate-400">{item.city}</span></span><span className="text-[10px] text-slate-500">约 {Math.round(item.distance)} 米</span></button>)}</div></>}
  {state.accuracy&&state.accuracy>500&&<p className="mt-2 text-[10px] text-slate-500">定位精度约 {Math.round(state.accuracy)} 米</p>}
  {state.message&&<p role="status" className="mt-3 text-xs leading-relaxed text-slate-500">{state.message}</p>}
  {['denied','error'].includes(state.status)&&<button type="button" onClick={onRetry} className="mt-3 text-xs font-bold text-m3-primary underline">重新定位</button>}
 </section>;
}
