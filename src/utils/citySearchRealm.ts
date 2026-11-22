/** City collection runs in a separate SDK realm; the map/public search SDK never changes credentials. */
type Reply={channel:string;id?:number;type:string;status?:string;result?:unknown};
let current:{key:string;securityCode:string;ready:Promise<any>;dispose:()=>void}|undefined;
export async function getCitySearchServices(key:string,securityCode:string):Promise<any>{
 key=key.trim();securityCode=securityCode.trim();
 if(!/^[a-f0-9]{32}$/i.test(key)||!/^[a-f0-9]{32}$/i.test(securityCode))throw Error('请先填写有效的高德 Key 和 Security Code。');
 if(current?.key===key&&current.securityCode===securityCode)return current.ready;
 current?.dispose();
 const iframe=document.createElement('iframe'),channel=crypto.randomUUID();
 iframe.hidden=true;iframe.title='城市检索服务';iframe.setAttribute('aria-hidden','true');
 let sequence=0,settled=false,disposed=false,nextRequestAt=0;
 const pending=new Map<number,{finish:(status:string,result:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
 let resolveReady:(services:any)=>void=()=>{},rejectReady:(error:Error)=>void=()=>{};
 const ready=new Promise<any>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const failReady=()=>{if(!settled){settled=true;rejectReady(Error('自有高德检索服务加载失败，请检查 Key、安全密钥和域名白名单。'));}};
 const timer=setTimeout(failReady,20000);
 const dispose=()=>{disposed=true;clearTimeout(timer);failReady();window.removeEventListener('message',receive);iframe.remove();for(const item of pending.values()){clearTimeout(item.timer);item.finish('error',{info:'SEARCH_CANCELLED'});}pending.clear();};
 const invoke=(service:string,options:any,method:string,args:any[],callback:(status:string,result:any)=>void)=>{
  const id=++sequence;
  const finish=(status:string,result:unknown)=>{const item=pending.get(id);if(!item)return;clearTimeout(item.timer);pending.delete(id);callback(status,result);};
  const sendAt=Math.max(Date.now(),nextRequestAt);
  nextRequestAt=sendAt+400;
  const delay=Math.max(0,sendAt-Date.now());
  pending.set(id,{finish,timer:setTimeout(()=>finish('error',{info:'SEARCH_TIMEOUT'}),12000+delay)});
  const send=()=>{if(!disposed && pending.has(id))iframe.contentWindow?.postMessage({channel,type:'query',id,service,options,method,args},window.location.origin);};
  if(delay) setTimeout(send,delay); else send();
 };
 const proxy=(service:string)=>class {
  private options:any;
  constructor(options:any={}){this.options={...options};}
  setPageIndex(pageIndex:number){this.options.pageIndex=pageIndex;}
  search(query:any,callback:any){invoke(service,{...this.options},'search',[query],callback);}
  searchInBounds(query:any,bounds:any,callback:any){const points=Array.isArray(bounds)?bounds:[[bounds.getSouthWest().lng,bounds.getSouthWest().lat],[bounds.getNorthEast().lng,bounds.getNorthEast().lat]];invoke(service,{...this.options},'searchInBounds',[query,points],callback);}
 };
 const receive=(event:MessageEvent<Reply>)=>{
  if(event.origin!==window.location.origin||event.source!==iframe.contentWindow||event.data?.channel!==channel)return;
  if(event.data.type==='ready'&&!settled){settled=true;clearTimeout(timer);resolveReady({PlaceSearch:proxy('PlaceSearch'),LineSearch:proxy('LineSearch'),StationSearch:proxy('StationSearch'),DistrictSearch:proxy('DistrictSearch')});}
  if(event.data.type==='error')failReady();
  if(event.data.type==='result'&&typeof event.data.id==='number')pending.get(event.data.id)?.finish(event.data.status||'error',event.data.result);
 };
 window.addEventListener('message',receive);
 iframe.addEventListener('load',()=>iframe.contentWindow?.postMessage({channel,type:'init',key,securityCode},window.location.origin),{once:true});
 iframe.addEventListener('error',failReady,{once:true});
 iframe.src=`${import.meta.env.BASE_URL}amap-search-frame.html`;
 current={key,securityCode,ready,dispose};
 // Failed initializations may be retried after correcting configuration or connectivity.
 void ready.catch(()=>{if(current?.ready===ready){current=undefined;dispose();}});
 document.body.appendChild(iframe);
 return ready;
}
