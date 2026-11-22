import {motion,useReducedMotion} from 'motion/react';
export function MapActivityIndicator({mode,raised=false,label=''}:{mode:'city'|'search'|null;raised?:boolean;label?:string}){
 const reduced=useReducedMotion();
 if(!mode)return null;
 const paths=['M4 17H20','M17 4V20','M8 20V13L13 8H22'];
 return <div role="status" aria-live="polite" className={`fixed left-4 sm:left-6 bottom-12 ${raised?'md:bottom-40':''} z-40 pointer-events-none select-none`}>
  <span className="sr-only">{label||(mode==='city'?'正在加载城市线路':'正在检索公交线路')}</span>
  <div className="flex flex-col items-start gap-2">
   <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-[20px] bg-[#eef3f0]/95 border border-[#dfe7e2] shadow-[0_7px_20px_rgba(30,55,43,0.14)] flex items-center justify-center text-[#3c7195] backdrop-blur-sm">
    {mode==='city'?<svg aria-hidden="true" width="28" height="28" viewBox="0 0 32 32" fill="none" className="animate-spin motion-reduce:animate-none">
     <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="3" opacity=".16"/>
     <path d="M16 4a12 12 0 0 1 12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </svg>:<svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none">
     {paths.map((d,i)=><g key={d}>
      <path d={d} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".12"/>
      <motion.path d={d} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
       animate={reduced?{pathLength:1,opacity:1}:{pathLength:[0,1,1,1],pathOffset:[0,0,0,1],opacity:[0,1,1,0]}}
       transition={reduced?{duration:0}:{duration:1.4,repeat:Infinity,ease:'easeInOut',delay:i*.18,times:[0,.3,.65,1]}}/>
     </g>)}
    </svg>}
   </div>
   {label&&<div aria-hidden="true" className="max-w-[240px] rounded-xl bg-[#eef3f0]/95 border border-[#dfe7e2] px-3 py-1.5 text-[11px] font-semibold leading-snug text-slate-600 shadow-[0_7px_20px_rgba(30,55,43,0.14)] backdrop-blur-sm">{label}</div>}
  </div>
 </div>;
}
