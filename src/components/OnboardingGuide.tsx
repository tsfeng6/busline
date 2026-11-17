import {createPortal} from 'react-dom';
import React,{useEffect,useRef,useState} from 'react';
import {motion} from 'motion/react';
import {ArrowLeft,ArrowRight,Check,Compass,KeyRound,Sparkles,ZoomIn} from 'lucide-react';
import {DaxingMapPreview} from './DaxingMapPreview';
import {TermsDocument} from './TermsDocument';
import {AMAP_API_PRIVACY_NOTICE,citySearchApiStatus} from '../utils/citySearchApi';
import {canAcceptTerms,reachedTermsEnd} from '../utils/onboardingConsent';
import {CITY_DETAIL_ZOOM} from '../utils/cityOverview';
interface OnboardingGuideProps{
 step:number;setStep:React.Dispatch<React.SetStateAction<number>>;
 useCustomApiKey:boolean;onSelectCustomApiKey:(enabled:boolean)=>void;
 customApiKey:string;setCustomApiKey:(value:string)=>void;
 customApiSecurityCode:string;setCustomApiSecurityCode:(value:string)=>void;
 onAcceptTerms:()=>void;onFinishOnboarding:()=>void;onZoomToBeijing:()=>void;
 mapReady:boolean;zoom:number;beijingReady:boolean;
}
export function OnboardingGuide({step,setStep,useCustomApiKey,onSelectCustomApiKey,customApiKey,setCustomApiKey,
 customApiSecurityCode,setCustomApiSecurityCode,onAcceptTerms,onFinishOnboarding,onZoomToBeijing,mapReady,zoom,beijingReady}:OnboardingGuideProps){
 const termsRef=useRef<HTMLDivElement>(null);
 const dialogRef=useRef<HTMLElement>(null);
 const [readToEnd,setReadToEnd]=useState(false),[agreed,setAgreed]=useState(false),[apiError,setApiError]=useState('');
 useEffect(()=>{
  setApiError('');
  if(step!==2)return;
  setReadToEnd(false);setAgreed(false);
  const panel=termsRef.current;if(!panel)return;panel.scrollTop=0;
  const check=()=>{if(reachedTermsEnd(panel))setReadToEnd(true);};
  const frame=requestAnimationFrame(check);
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(check):null;observer?.observe(panel);
  window.addEventListener('resize',check);
  return()=>{cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',check);};
 },[step]);
 useEffect(()=>{
  if(step<1||step>3)return;
  const root=document.getElementById('root');
  const previous=root?.inert;if(root)root.inert=true;
  const focus=step===2?termsRef.current:dialogRef.current?.querySelector<HTMLElement>('input,button');
  focus?.focus({preventScroll:true});
  return()=>{if(root)root.inert=previous||false;};
 },[step]);
 const handleNext=()=>{
  if(step===2){if(!canAcceptTerms(readToEnd,agreed))return;onAcceptTerms();}
  if(step===3&&citySearchApiStatus(useCustomApiKey,customApiKey,customApiSecurityCode)==='missing'&&useCustomApiKey){
   setApiError('请填写有效的高德 Web端 API Key 和 Security Code，或选择暂不填写。');return;
  }
  if(step===4)onFinishOnboarding();else setStep(step+1);
 };
 if(step===0)return null;
 if(step===4)return <section role="region" aria-label="北京市线路查看引导" className="fixed bottom-24 sm:bottom-20 left-4 right-4 sm:right-auto sm:left-6 z-[135] sm:w-80 rounded-3xl border border-m3-outline-variant/40 bg-m3-surface/95 p-5 shadow-xl pointer-events-auto">
  <div className="flex items-center gap-2 text-m3-primary"><Compass className="w-5 h-5"/><span className="text-[10px] font-bold">4 / 4</span></div>
  <h2 className="mt-3 text-lg font-bold text-slate-900">放大，查看北京市线路图</h2>
  <p role="status" className="mt-2 text-xs leading-relaxed text-slate-600">{!mapReady?'正在准备地图…':beijingReady?'北京市线路已显示。试着点击线路或站点，查看详细信息。':zoom<CITY_DETAIL_ZOOM?'向上滚动鼠标滚轮，或双指展开地图；放大到城市街区后，会自动加载北京市线路。':'正在读取共享线路，您也可以继续在地图上缩放和移动。'}</p>
  <div className="mt-4 flex flex-wrap gap-2">
   <button type="button" disabled={!mapReady} onClick={onZoomToBeijing} className="rounded-full bg-m3-primary-container text-m3-on-primary-container px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"><ZoomIn className="w-4 h-4"/>放大查看线路</button>
   <button type="button" onClick={handleNext} className="rounded-full bg-m3-primary text-m3-on-primary px-4 py-2 text-xs font-bold">开始浏览</button>
  </div>
 </section>;
 return createPortal(<div className="fixed inset-0 z-[130] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto">
  <motion.section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" initial={{opacity:0,scale:.96,y:12}} animate={{opacity:1,scale:1,y:0}}
   className="w-[520px] max-w-[94vw] max-h-[92dvh] bg-m3-surface border border-m3-outline-variant/40 rounded-[28px] shadow-2xl overflow-hidden flex flex-col">
   <div className="px-6 pt-5 pb-2 flex justify-between items-center shrink-0"><div className="flex gap-1.5">{[1,2,3,4].map(n=><div key={n} className={`h-1.5 rounded-full ${n===step?'w-6 bg-m3-primary':n<step?'w-2.5 bg-m3-primary/45':'w-2.5 bg-m3-surface-container-highest'}`}/>)}</div><span className="text-[10px] font-bold text-slate-400">{step} / 4</span></div>
   <div className="px-6 py-4 min-h-0 overflow-y-auto space-y-4">
    {step===1&&<>
     <DaxingMapPreview thickness="thick" searchMode="static" replay={0} showCampusArrow={false}/>
     <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-m3-primary-container text-m3-on-primary-container text-[10px] font-bold"><Sparkles className="w-3 h-3"/>busline 5.5</span>
     <h2 id="onboarding-title" className="text-xl font-bold text-slate-900">欢迎使用巴士线路图</h2>
     <p className="text-xs leading-relaxed text-slate-500">探索城市公交线路、站点与线网分布。开始前，请先阅读使用条款。</p>
    </>}
    {step===2&&<>
     <h2 id="onboarding-title" className="text-lg font-bold text-slate-900">阅读并同意使用条款</h2>
     <div ref={termsRef} tabIndex={0} role="region" aria-label="巴士线路图使用条款全文" onScroll={event=>{if(reachedTermsEnd(event.currentTarget))setReadToEnd(true);}}
      className="h-[min(44dvh,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-m3-outline-variant/40 bg-m3-surface-container-low p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary">
      <TermsDocument/>
     </div>
     <p role="status" className="text-[11px] text-slate-500">{readToEnd?'已阅读至末尾，请勾选同意后继续。':'请向下滑动阅读全部条款，阅读至末尾后可勾选同意。'}</p>
     <label className={`flex gap-2.5 items-start text-xs font-bold leading-relaxed ${readToEnd?'text-slate-700 cursor-pointer':'text-slate-400'}`}>
      <input type="checkbox" disabled={!readToEnd} checked={agreed} onChange={event=>setAgreed(event.target.checked)} className="mt-0.5 accent-[#52796F] w-4 h-4 shrink-0"/>
      我已阅读并同意以上条款
     </label>
    </>}
    {step===3&&<>
     <div className="w-10 h-10 rounded-2xl bg-m3-primary-container text-m3-primary flex items-center justify-center"><KeyRound className="w-5 h-5"/></div>
     <h2 id="onboarding-title" className="text-lg font-bold text-slate-900">是否填写高德 API？</h2>
     <p className="text-xs leading-relaxed text-slate-600">填写高德 API 将用于公交线路检索与提交。查看已有共享线路无需填写，普通搜索使用公共 API；您也可稍后在设置中填写。</p>
     <fieldset className="grid grid-cols-2 gap-2"><legend className="sr-only">高德 API 配置选择</legend>{[{enabled:false,label:'暂不填写'},{enabled:true,label:'现在填写'}].map(option=><label key={option.label} className={`rounded-2xl p-3 border cursor-pointer text-xs font-bold flex gap-2 items-center ${useCustomApiKey===option.enabled?'border-m3-primary bg-m3-primary-container/40 text-m3-primary':'border-m3-outline-variant/40 text-slate-600'}`}><input type="radio" name="onboarding-api" checked={useCustomApiKey===option.enabled} onChange={()=>{setApiError('');onSelectCustomApiKey(option.enabled);}} className="accent-[#52796F]"/>{option.label}</label>)}</fieldset>
     {useCustomApiKey&&<div className="space-y-3">
      <label className="block text-xs font-bold text-slate-600">高德 Web端 API Key<input type="password" autoComplete="off" value={customApiKey} onChange={event=>{setApiError('');setCustomApiKey(event.target.value);}} placeholder="请输入您的 API Key" className="block w-full mt-1.5 px-3 py-2.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant outline-none focus:border-m3-primary"/></label>
      <label className="block text-xs font-bold text-slate-600">高德安全密钥 Security Code<input type="password" autoComplete="off" value={customApiSecurityCode} onChange={event=>{setApiError('');setCustomApiSecurityCode(event.target.value);}} placeholder="请输入您的 Security Code" className="block w-full mt-1.5 px-3 py-2.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant outline-none focus:border-m3-primary"/></label>
     </div>}
     <p className="text-[11px] leading-relaxed text-slate-500">{AMAP_API_PRIVACY_NOTICE}</p>
     <p className="text-[11px] leading-relaxed text-amber-800 bg-amber-50 rounded-xl p-3">请遵守高德开放平台的服务协议及相关法律法规。因用户违规操作产生的责任，应由用户依法自行承担。</p>
     {apiError&&<p role="alert" className="text-xs text-m3-error">{apiError}</p>}
    </>}
   </div>
   <div className="px-6 pt-2 pb-5 flex items-center justify-between gap-3 shrink-0">
    {step>1?<button type="button" onClick={()=>setStep(step-1)} className="text-xs text-slate-500 font-bold flex gap-1 items-center px-2 py-2"><ArrowLeft className="w-4 h-4"/>上一步</button>:<span/>}
    <button type="button" onClick={handleNext} disabled={step===2&&!canAcceptTerms(readToEnd,agreed)} className="rounded-2xl bg-m3-primary text-m3-on-primary px-5 py-3 text-xs font-bold shadow-sm disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-2">
     {step===1?'开始':step===2?'同意并继续':'进入地图引导'}{step===2?<Check className="w-4 h-4"/>:<ArrowRight className="w-4 h-4"/>}
    </button>
   </div>
  </motion.section>
 </div>,document.body);
}
