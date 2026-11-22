import {motion,useReducedMotion} from 'motion/react';
export function MapActivityIndicator({mode,raised=false,progress}:{mode:'city'|'search'|null;raised?:boolean;progress?:{value:number;label:string}|null}){
 const reduced=useReducedMotion();
 if(!mode)return null;
 const paths=['M4 17H20','M17 4V20','M8 20V13L13 8H22'];
 const value=Math.max(0,Math.min(100,progress?.value ?? 8));
 return <div role="status" aria-live="polite" className={`fixed left-4 sm:left-6 bottom-12 ${raised?'md:bottom-40':''} z-40 pointer-events-none select-none`}>
  <div className="w-56 rounded-2xl bg-[#eef3f0]/95 border border-[#dfe7e2] shadow-[0_7px_20px_rgba(30,55,43,0.14)] px-3 py-2.5 text-[#3c7195] backdrop-blur-sm">
   <div className="flex items-center gap-2">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center">
     <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none">
    {paths.map((d,i)=><g key={d}>
     <path d={d} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".12"/>
     <motion.path d={d} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      animate={reduced?{pathLength:1,opacity:1}:{pathLength:[.25,1],opacity:[.55,1]}}
      transition={reduced?{duration:0}:{duration:.35,ease:'easeOut',delay:i*.06}}/>
    </g>)}
     </svg>
    </div>
    <div className="min-w-0 flex-1">
     <div className="flex items-center justify-between gap-2 text-[11px] font-bold"><span className="truncate">{progress?.label || (mode==='city'?'正在加载城市线路':'正在检索公交线路')}</span><span>{Math.round(value)}%</span></div>
     <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#3c7195]/15"><motion.div className="h-full rounded-full bg-[#3c7195]" initial={false} animate={{width:`${value}%`}} transition={{duration:reduced?0:.25,ease:'easeOut'}}/></div>
    </div>
   </div>
  </div>
 </div>;
}
