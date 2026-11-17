import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { cityDataKey } from '../../src/utils/cityDataset';
import { MAX_CITY_BYTES, CITY_CHUNK_BYTES, CITY_UPLOAD_FORMAT, CITY_RECORD_FORMAT } from '../../src/utils/cityTransfer';

export interface UploadStore {
  get(key:string,options?:any):Promise<any>;
  set(key:string,value:string|ArrayBuffer):Promise<void>;
  delete(key:string):Promise<void>;
  list(options?:any):Promise<{blobs:{key:string}[]}>;
}
type Env=Record<string,string|undefined>;
type Session={id:string;city:string;bytes:number;parts:number;sha256:string;format:string;tokenHash:string;expires:number};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Temporary upload gate: only a one-way verifier is kept in server code. Override to rotate it.
const defaultUploadKeyHash='fbd209dc807d3e0ca4be652fe6d5992123a4a7af3a2160533c68aee5752d105f';
const terminal=new Set(['completed','retained','failed']);
const fail=(status:number,message:string)=>Object.assign(Error(message),{status});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const gatewaySignature=(secret:string,text:string)=>createHmac('sha256',secret).update(text).digest('hex');
async function bodyBytes(request:Request,limit:number){
  if(Number(request.headers.get('content-length')||0)>limit)throw fail(413,'请求内容过大。');
  // Some Node function adapters expose arrayBuffer()/text(), but not a Web ReadableStream body.
  if(!request.body||typeof request.body.getReader!=='function'){
    const bytes=typeof request.arrayBuffer==='function'?new Uint8Array(await request.arrayBuffer()):new TextEncoder().encode(await request.text());
    if(bytes.byteLength>limit)throw fail(413,'请求内容过大。');
    return bytes;
  }
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit){await reader.cancel();throw fail(413,'请求内容过大。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
async function jsonBody(request:Request,limit=8192){try{return JSON.parse(new TextDecoder().decode(await bodyBytes(request,limit)));}catch(e:any){if(e.status)throw e;throw fail(400,'请求格式无效。');}}
/** Instance-local serialization; Blob has no compare-and-swap, so it is not a distributed lock. */
const tasks=new Map<string,Promise<unknown>>();
async function serial<T>(key:string,action:()=>Promise<T>):Promise<T>{
  const previous=tasks.get(key)||Promise.resolve();const task=previous.catch(()=>{}).then(action);tasks.set(key,task);
  try{return await task;}finally{if(tasks.get(key)===task)tasks.delete(key);}
}
export async function handleEdgeOneGateway(request:Request,env:Env,store:UploadStore,transport:typeof fetch=fetch,clientIp=''){
  const origin=request.headers.get('Origin')||'';
  const allowed=(env.ALLOWED_ORIGINS||'https://busline.cc,https://www.busline.cc').split(',').map(x=>x.trim());
  const cors:Record<string,string>=allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'}});
  const get=async(key:string)=>store.get(key,{type:'json',consistency:'strong'});
  const put=(key:string,value:unknown)=>store.set(key,JSON.stringify(value));
  const sessionKey=(id:string)=>`sessions/${id}.json`,jobKey=(id:string)=>`jobs/${id}.json`;
  // Bounded cleanup makes progress across requests without loading large objects into memory.
  const cleanup=async(id:string)=>{
    const chunks=await store.list({prefix:`chunks/${id}/`,consistency:'strong'});
    for(let i=0;i<Math.min(chunks.blobs.length,64);i+=8)await Promise.all(chunks.blobs.slice(i,i+8).map(item=>store.delete(item.key)));
    if(chunks.blobs.length<=64)await store.delete(sessionKey(id));
  };
  const gc=async()=>{
    const entries=await store.list({prefix:'sessions/',consistency:'strong'});
    let active=0,reserved=0,swept=0;
    for(const item of entries.blobs){const session:Session|null=await get(item.key);if(!session)continue;
      if(session.expires<=Date.now()){if(swept++<2)await cleanup(session.id);}
      else{const job=await get(jobKey(session.id));if(terminal.has(job?.state)){if(swept++<2)await cleanup(session.id);}else{active++;reserved+=session.bytes;}}
    }
    return {active,reserved};
  };
  try{
    const path=new URL(request.url).pathname;
    if(path==='/health'&&request.method==='GET')return json({service:'busline-city-gateway',platform:'edgeone',version:1,
      configured:!!env.GITHUB_DISPATCH_TOKEN&&(env.CALLBACK_SECRET?.length||0)>=32&&(env.RATE_LIMIT_SALT?.length||0)>=16});
    if(!env.GITHUB_DISPATCH_TOKEN||(env.CALLBACK_SECRET?.length||0)<32||(env.RATE_LIMIT_SALT?.length||0)<16)throw fail(503,'上传入口尚未配置完成。');
    const repo=env.GITHUB_REPO||'tsfeng6/busline',ref=env.GITHUB_WORKFLOW_REF||'main';
    if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!/^[-\w/]+$/.test(ref))throw fail(503,'仓库配置无效。');
    if(path==='/jobs/callback'&&request.method==='POST'){
      const raw=new TextDecoder().decode(await bodyBytes(request,8192));
      if(!equal(gatewaySignature(env.CALLBACK_SECRET!,raw),request.headers.get('x-city-signature')||''))throw fail(401,'回调认证失败。');
      let input:any;try{input=JSON.parse(raw);}catch{throw fail(400,'请求格式无效。');}
      if(!uuid.test(input.id||'')||!Number.isFinite(input.at)||Math.abs(Date.now()-input.at)>300000||!['running','completed','retained','failed'].includes(input.state))throw fail(400,'回调参数无效。');
      return await serial(input.id,async()=>{
        const job=await get(jobKey(input.id));
        if(!job||cityDataKey(job.city)!==cityDataKey(input.city)||job.expires<=Date.now())throw fail(409,'任务已失效。');
        if(terminal.has(job.state))return json({accepted:job.state===input.state},job.state===input.state?200:409);
        const result=input.result?{promoted:input.result.promoted===true,lineDirections:Number(input.result.lineDirections)||0,
          stops:Number(input.result.stops)||0,snapshotId:String(input.result.snapshotId||'').slice(0,100)}:undefined;
        await put(jobKey(input.id),{...job,state:input.state,message:String(input.message||'正在保存。').slice(0,200),result,updatedAt:Date.now()});
        if(terminal.has(input.state))try{await cleanup(input.id);}catch{/* A later sweep retries cleanup; never fail a saved result. */}
        return json({accepted:true});
      });
    }
    const match=/^\/uploads\/([^/]+)(?:\/(complete|chunks\/(\d+)))?$/.exec(path);
    // Actions authenticate downloads with a short-lived HMAC, independently of browser Origin.
    if(match&&request.method==='GET'){
      const [,id,,index]=match;const at=Number(request.headers.get('x-city-timestamp'));
      if(!uuid.test(id)||!Number.isFinite(at)||Math.abs(Date.now()-at)>300000||!equal(gatewaySignature(env.CALLBACK_SECRET!,`${id}:${index===undefined?'manifest':index}:${at}`),request.headers.get('x-city-signature')||''))throw fail(401,'下载认证失败。');
      const session:Session|null=await get(sessionKey(id)),job=await get(jobKey(id));
      if(!session||session.expires<=Date.now()||!job||!['queued','running'].includes(job.state)||!job.submitted)throw fail(409,'上传未完成或已过期。');
      if(index===undefined)return json({id,city:session.city,bytes:session.bytes,parts:session.parts,sha256:session.sha256,format:session.format});
      const number=Number(index);if(!Number.isInteger(number)||number<0||number>=session.parts)throw fail(400,'片段编号无效。');
      const part=await store.get(`chunks/${id}/${number}`,{type:'arrayBuffer',consistency:'strong'});
      if(!part)throw fail(404,'片段不存在。');
      return new Response(part,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
    }
    if(!allowed.includes(origin))throw fail(403,'此来源不允许访问上传入口。');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,x-city-upload-token,x-city-upload-key','Access-Control-Max-Age':'600'}});
    if(request.method==='GET'&&/^\/jobs\/[^/]+$/.test(path)){
      const id=path.split('/')[2];if(!uuid.test(id))throw fail(400,'任务编号无效。');
      const job=await get(jobKey(id));if(!job)throw fail(404,'任务不存在。');
      if(!terminal.has(job.state)&&job.expires<=Date.now()){
        job.state='failed';job.message='保存任务已超时，请重新提交。';await put(jobKey(id),job);
      }
      return json({id:job.id,city:job.city,state:job.state,message:job.message,createdAt:job.createdAt,updatedAt:job.updatedAt,result:job.result});
    }
    if(path==='/uploads'&&request.method==='POST'){
      const supplied=request.headers.get('x-city-upload-key')||'';
      const expected=env.UPLOAD_ACCESS_KEY_SHA256||defaultUploadKeyHash;
      if(!/^[a-f0-9]{64}$/.test(expected))throw fail(503,'上传密钥配置无效。');
      if(!supplied||supplied.length>256||!equal(hash(supplied),expected))throw fail(401,'上传密钥错误，请重新输入。');
      const input=await jsonBody(request,1024);try{cityDataKey(input.city);}catch{throw fail(400,'城市名称无效。');}
      const size=input.bytes,parts=input.parts;
      if(!Number.isInteger(size)||size<2||size>MAX_CITY_BYTES||parts!==Math.ceil(size/CITY_CHUNK_BYTES)||!/^[a-f0-9]{64}$/.test(input.sha256||'')||![CITY_UPLOAD_FORMAT,CITY_RECORD_FORMAT,'json'].includes(input.format||'json'))throw fail(400,'上传信息无效或超过1GB（1GiB）。');
      return await serial('create',async()=>{
        const {active,reserved}=await gc();if(active>=8||reserved+size>MAX_CITY_BYTES*1.5)throw fail(429,'上传任务繁忙，请稍后重试。');
        if(clientIp){const key=`rate/${gatewaySignature(env.RATE_LIMIT_SALT!,clientIp).slice(0,40)}.json`,last=await get(key);
          if(last&&Date.now()-last.at<60000)throw fail(429,'提交过于频繁，请稍后重试。');await put(key,{at:Date.now()});}
        const id=randomUUID(),token=randomBytes(32).toString('hex'),now=Date.now(),expires=now+2*3600000;
        await put(sessionKey(id),{id,city:input.city,bytes:size,parts,sha256:input.sha256,format:input.format||'json',tokenHash:hash(token),expires});
        await put(jobKey(id),{id,city:input.city,state:'queued',message:'正在接收本地检索结果。',createdAt:now,updatedAt:now,expires,submitted:false});
        return json({id,token,chunkSize:CITY_CHUNK_BYTES});
      });
    }
    if(!match||!uuid.test(match[1]))throw fail(404,'没有这个上传接口。');
    const [,id,action,index]=match;
    const session:Session|null=await get(sessionKey(id));
    if(!session||session.expires<=Date.now())throw fail(409,'上传任务已过期。');
    if(!equal(hash(request.headers.get('x-city-upload-token')||''),session.tokenHash))throw fail(401,'上传认证失败。');
    if(request.method==='PUT'&&index!==undefined){
      const job=await get(jobKey(id));if(job.submitted||terminal.has(job.state))throw fail(409,'结果已提交保存。');
      const number=Number(index);if(!Number.isInteger(number)||number<0||number>=session.parts)throw fail(400,'片段编号无效。');
      const bytes=await bodyBytes(request,CITY_CHUNK_BYTES);
      if(bytes.length!==(number===session.parts-1?session.bytes-number*CITY_CHUNK_BYTES:CITY_CHUNK_BYTES))throw fail(400,'片段长度不符。');
      await store.set(`chunks/${id}/${number}`,bytes.buffer);return json({received:number});
    }
    return await serial(id,async()=>{
      const job=await get(jobKey(id));
      if(request.method==='DELETE'){
        if(job.submitted)throw fail(409,'结果正在保存，请等待完成。');
        await put(jobKey(id),{...job,state:'failed',message:'上传已取消。',updatedAt:Date.now()});await cleanup(id);return json({cancelled:true});
      }
      if(request.method!=='POST'||action!=='complete')throw fail(404,'没有这个上传接口。');
      if(job.submitted)return json({id,city:job.city,state:job.state,message:job.message},202);
      const uploaded=new Set((await store.list({prefix:`chunks/${id}/`,consistency:'strong'})).blobs.map(item=>item.key));
      for(let n=0;n<session.parts;n++)if(!uploaded.has(`chunks/${id}/${n}`))throw fail(409,'上传尚未完整，请重试。');
      await put(jobKey(id),{...job,submitted:true,message:'上传完成，等待校验并保存到 GitHub。',updatedAt:Date.now()});
      let response:Response;
      try{response=await transport(`https://api.github.com/repos/${repo}/actions/workflows/update-city-data.yml/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${env.GITHUB_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'Busline-EdgeOne-Gateway','Content-Type':'application/json'},body:JSON.stringify({ref,inputs:{city:session.city,request_id:id,uploaded:true}}),signal:AbortSignal.timeout(15000)});}catch{response=new Response(null,{status:502});}
      if(!response.ok){await put(jobKey(id),{...job,submitted:true,state:'failed',message:'无法确认远端保存任务是否启动，请稍后检查任务。',updatedAt:Date.now()});throw fail(502,'无法启动远端保存；本地地图不受影响。');}
      return json({id,city:job.city,state:'queued',message:'已提交，等待校验并保存到 GitHub。'},202);
    });
  }catch(error:any){const status=[400,401,403,404,409,413,429,502,503].includes(error.status)?error.status:503;
    return json({error:status===503?'上传服务暂时不可用，请稍后重试。':error.message},status);}
}
