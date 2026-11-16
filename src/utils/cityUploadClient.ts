import { normalizeCityDataset, type CityDataset } from './cityDataset';
import type { CityUpdateJob } from './cityUpdateJobs';
export async function uploadCitySnapshot(base:string,input:CityDataset,onProgress:(percent:number)=>void=()=>{},transport:typeof fetch=(url,init)=>globalThis.fetch(url,init)){
  if(!base)throw Error('远端上传入口未配置；本地地图不受影响。');
  const target=new URL(base);
  if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname)))throw Error('远端上传地址未正确配置。');
  const data=normalizeCityDataset(input);
  if(data.filtered)throw Error('开启线路过滤的结果不能提交为全市共享数据。');
  const bytes=new TextEncoder().encode(JSON.stringify(data)),chunkSize=256*1024;
  if(bytes.length>30*1024*1024)throw Error('本次数据超过30MiB，仍可保留地图或导出JSON。');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const request=async(path:string,init:RequestInit={})=>{
    const response=await transport(base.replace(/\/$/,'')+path,{...init,signal:AbortSignal.timeout(30000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'远端提交失败；本地地图不受影响。');return result;
  };
  let upload:any=null,submitted=false;
  try{
    upload=await request('/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:data.city,bytes:bytes.length,parts:Math.ceil(bytes.length/chunkSize),sha256:hash})});
    if(!/^[a-f0-9-]{36}$/.test(upload.id)||typeof upload.token!=='string'||upload.chunkSize!==chunkSize)throw Error('上传入口返回异常。');
    const headers={'Content-Type':'application/octet-stream','x-city-upload-token':upload.token};
    let done=0,next=0;
    const parts=Math.ceil(bytes.length/chunkSize);
    const transfers=await Promise.allSettled(Array.from({length:Math.min(3,parts)},async()=>{
      while(next<parts){const index=next++;let error:unknown;
        for(let attempt=0;attempt<3;attempt++){
          try{await request(`/uploads/${upload.id}/chunks/${index}`,{method:'PUT',headers,body:bytes.slice(index*chunkSize,(index+1)*chunkSize)});error=null;break;}catch(e){error=e;}
        }
        if(error)throw error;onProgress(Math.round(++done/parts*100));
      }
    }));
    const failed=transfers.find((entry):entry is PromiseRejectedResult=>entry.status==='rejected');
    if(failed)throw failed.reason;
    const job=await request(`/uploads/${upload.id}/complete`,{method:'POST',headers:{'x-city-upload-token':upload.token}}) as CityUpdateJob;
    if(job.id!==upload.id||job.city!==data.city||!['queued','running','completed','retained'].includes(job.state))throw Error('远端任务状态异常。');
    submitted=true;return job;
  }finally{
    if(upload&&!submitted)try{await request(`/uploads/${upload.id}`,{method:'DELETE',headers:{'x-city-upload-token':upload.token}});}catch{/* Expired sessions are also cleaned by the gateway. */}
  }
}
