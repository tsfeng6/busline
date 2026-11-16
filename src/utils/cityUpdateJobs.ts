import { cityDataKey } from './cityDataset';
export type CityUpdateJob = {id?:string;city:string;state:'ready'|'queued'|'running'|'completed'|'retained'|'failed';message:string;
  createdAt?:number;updatedAt?:number;result?:{promoted:boolean;lineDirections:number;stops:number;snapshotId?:string}};
export class CityUpdateJobClient {
  constructor(private base:string,private transport:typeof fetch=fetch) {
    this.base=base.replace(/\/$/,'');
  }
  private async request(path:string,init:RequestInit={},signal?:AbortSignal):Promise<CityUpdateJob>{
    if(!this.base)throw new Error('尚未配置城市更新入口。');
    let url:URL;try{url=new URL(this.base);}catch{throw new Error('更新入口地址无效。');}
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('更新入口需要 HTTPS。');
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,20000);
    try{
      const response=await this.transport(this.base+path,{...init,signal:controller.signal,cache:'no-store'});
      let result:any;try{result=await response.json();}catch{throw new Error('更新入口返回异常，请稍后重试。');}
      if(!response.ok)throw Object.assign(new Error(result.error||'无法提交城市更新。'),{status:response.status});
      if(!['ready','queued','running','completed','retained','failed'].includes(result.state)||typeof result.city!=='string')throw new Error('任务状态无效。');
      cityDataKey(result.city);
      if(result.state!=='ready'&&!/^[a-f0-9-]{36}$/.test(result.id||''))throw new Error('任务编号无效。');
      return result;
    }catch(error:any){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(error.name==='AbortError')throw new Error('更新入口连接超时，请稍后重试。');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async start(city:string,signal?:AbortSignal){
    cityDataKey(city);
    const job=await this.request('/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city})},signal);
    if(cityDataKey(job.city)!==cityDataKey(city))throw new Error('任务城市与请求不一致。');
    return job;
  }
  async get(id:string,signal?:AbortSignal){
    if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('任务编号无效。');
    return this.request(`/jobs/${id}`,{},signal);
  }
  async watch(initial:CityUpdateJob,onProgress:(job:CityUpdateJob)=>void,signal:AbortSignal,interval=5000,maxWait=35*60000){
    let job=initial;const started=Date.now();onProgress(job);
    while(['queued','running'].includes(job.state)){
      if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      if(Date.now()-started>maxWait)throw new Error('任务仍在后台进行，可稍后回来查看。');
      await new Promise<void>((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},interval);
        signal.addEventListener('abort',abort,{once:true});
      });
      job=await this.get(job.id!,signal);
      if(cityDataKey(job.city)!==cityDataKey(initial.city))throw new Error('任务城市发生异常。');
      onProgress(job);
    }
    return job;
  }
}
