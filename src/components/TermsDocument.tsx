import terms from '../content/busline-terms.md?raw';
/** Render the small Markdown subset used by our independently maintained terms file, without HTML injection. */
export function TermsDocument(){
 return <article className="text-xs leading-7 text-slate-600 space-y-3 select-text">
  {terms.trim().split(/\n\s*\n/).map((block,index)=>{
   if(block.startsWith('## '))return <h3 key={index} className="text-sm font-bold text-slate-800 pt-2">{block.slice(3)}</h3>;
   if(/^\d+\. /m.test(block))return <ol key={index} className="list-decimal pl-5 space-y-2">{block.split('\n').map((line,item)=><li key={item}>{line.replace(/^\d+\. /,'')}</li>)}</ol>;
   if(block.startsWith('**')&&block.endsWith('**'))return <p key={index} className="font-bold">{block.slice(2,-2)}</p>;
   return <p key={index} className={index===0?'font-bold text-base text-slate-900':''}>{block}</p>;
  })}
 </article>;
}
