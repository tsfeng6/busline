import { handleCityUploads, cleanCityUpload } from './uploads';
import { cityDataKey, cityDatasetExpiresAt } from '../../src/utils/cityDataset';
interface Statement { bind(...values: any[]): Statement; first<T=any>(): Promise<T|null>; run(): Promise<any>; }
interface Database { prepare(sql:string):Statement; batch(statements:Statement[]):Promise<any[]>; }
export interface Env {
  JOBS:Database; ALLOWED_ORIGINS:string; GITHUB_REPO:string; GITHUB_DISPATCH_TOKEN:string;
  GITHUB_WORKFLOW_REF?:string; CITY_DATA_BRANCH?:string; CALLBACK_SECRET:string;
  RATE_LIMIT_SALT:string; MAX_UPDATES_PER_DAY?:string; DAILY_UPDATE_LIMITS_ENABLED?:string;
}
type Job={city_key:string;id:string;city:string;state:string;message:string;created_at:number;updated_at:number;expires_at:number;result_json:string|null};
const terminal=new Set(['completed','retained','failed']);
const fail=(status:number,message:string)=>Object.assign(new Error(message),{status});
const encoder=new TextEncoder();
async function sign(secret:string,body:string) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(body)))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
async function verify(secret:string,body:string,signature:string) {
  if(!/^[a-f0-9]{64}$/.test(signature))return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g)!,pair=>parseInt(pair,16));
  return crypto.subtle.verify('HMAC',key,bytes,encoder.encode(body));
}
async function limitedBody(request:Pick<Request,'headers'|'body'>,limit:number) {
  if(Number(request.headers.get('content-length')||0)>limit)throw fail(413,'请求内容过大。');
  const reader=request.body?.getReader();if(!reader)return '';
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit){await reader.cancel();throw fail(413,'请求内容过大。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(bytes);
}
function publicJob(job:Job) {
  return {id:job.id,city:job.city,state:job.state,message:job.message,createdAt:job.created_at,updatedAt:job.updated_at,
    ...(job.result_json?{result:JSON.parse(job.result_json)}:{})};
}
function rawUrl(env:Env,path:string) {
  return `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${encodeURIComponent(env.CITY_DATA_BRANCH||'busline-data')}/city-data/v1/${path}`;
}
async function smallFile(transport:typeof fetch,url:string) {
  const response=await transport(url,{signal:AbortSignal.timeout(8000)});
  if(response.status===404)return null;
  if(!response.ok)throw fail(502,'暂时无法检查城市数据，请稍后重试。');
  return JSON.parse(await limitedBody(response,65536));
}
async function cityFresh(env:Env,city:string,transport:typeof fetch) {
  const prefix=encodeURIComponent(cityDataKey(city));
  const meta=await smallFile(transport,rawUrl(env,`${prefix}/meta.json`));
  return !!meta&&cityDataKey(meta.city)===cityDataKey(city)&&meta.retrievalComplete===true&&meta.filtered!==true
    &&Date.parse(meta.capturedAt)<=Date.now()+300000&&Date.now()<cityDatasetExpiresAt(meta);
}
export async function handleGateway(request:Request,env:Env,transport:typeof fetch=fetch):Promise<Response> {
  const origin=request.headers.get('Origin')||'';
  const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(item=>item.trim()).filter(Boolean);
  const cors:Record<string,string>=allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
  const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'}});
  try{
    const url=new URL(request.url),path=url.pathname;
    if(!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO))throw fail(503,'更新入口尚未配置。');
    if(path==='/jobs/callback'&&request.method==='POST'){
      if(!env.CALLBACK_SECRET||env.CALLBACK_SECRET.length<32)throw fail(503,'任务回调尚未配置。');
      const raw=await limitedBody(request,8192);
      if(!await verify(env.CALLBACK_SECRET,raw,request.headers.get('x-city-signature')||''))throw fail(401,'回调认证失败。');
      const body=JSON.parse(raw);
      if(!Number.isFinite(body.at)||Math.abs(Date.now()-body.at)>300000||!/^[a-f0-9-]{36}$/.test(body.id||''))throw fail(400,'回调参数无效。');
      if(!['running','completed','retained','failed'].includes(body.state))throw fail(400,'任务状态无效。');
      const job=await env.JOBS.prepare('SELECT * FROM city_jobs WHERE id=?').bind(body.id).first<Job>();
      if(!job||job.city_key!==cityDataKey(body.city))throw fail(409,'任务已失效。');
      if(terminal.has(job.state))return json({accepted:job.state===body.state},job.state===body.state?200:409);
      if(job.expires_at<Date.now())throw fail(409,'任务已超时，停止本次查询。');
      const message=typeof body.message==='string'?body.message.slice(0,200):'正在更新。';
      const result=body.result?{promoted:body.result.promoted===true,lineDirections:Number(body.result.lineDirections)||0,
        stops:Number(body.result.stops)||0,snapshotId:typeof body.result.snapshotId==='string'?body.result.snapshotId.slice(0,100):''}:null;
      const expires=terminal.has(body.state)?Date.now()+600000:Date.now()+45*60000;
      await env.JOBS.prepare('UPDATE city_jobs SET state=?,message=?,updated_at=?,expires_at=?,result_json=? WHERE id=? AND state IN (\'queued\',\'running\')')
        .bind(body.state,message,Date.now(),expires,result?JSON.stringify(result):null,body.id).run();
      if(terminal.has(body.state))await cleanCityUpload(env,body.id);
      return json({accepted:true});
    }
    if(request.method==='GET'&&path.startsWith('/uploads/'))return await handleCityUploads(request,env,transport);
    if(!allowed.includes(origin))throw fail(403,'此来源不允许访问更新入口。');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,x-city-upload-token','Access-Control-Max-Age':'600'}});
    if(path==='/uploads'||path.startsWith('/uploads/')){
      const result=await handleCityUploads(request,env,transport);
      const headers=new Headers(result.headers);for(const [key,value] of Object.entries(cors))headers.set(key,value);
      return new Response(result.body,{status:result.status,headers});
    }
    // Compatibility reader for direct gateway callers. The website uses its own static files.
    if(request.method==='GET'&&path.startsWith('/api/city-data/')){
      const parts=path.slice('/api/city-data/'.length).split('/').map(decodeURIComponent);
      const key=encodeURIComponent(cityDataKey(parts[0]));
      let suffix='latest.json';
      if(parts.length===2&&parts[1]==='history')suffix='history.json';
      else if(parts.length===3&&parts[1]==='history'&&/^[\dTZ-]+-[a-f0-9]{12}$/.test(parts[2]))suffix=`history/${parts[2]}.json`;
      else if(parts.length===4&&parts[1]==='parts'&&/^[\dTZ-]+-[a-f0-9]{12}$/.test(parts[2])&&/^\d+\.json$/.test(parts[3]))suffix=`parts/${parts[2]}/${parts[3]}`;
      else if(parts.length===3&&parts[1]==='bvpk'&&/^[a-f0-9]{64}\.bvpk$/.test(parts[2]))suffix=`bvpk/${parts[2]}`;
      else if(parts.length!==1)throw fail(404,'没有这个数据文件。');
      const version=url.searchParams.get('v');
      const binary=suffix.startsWith('bvpk/');
      const versioned = !binary && /^(?:[a-f0-9-]{36}|[\dTZ-]+-[a-f0-9]{12})$/.test(version||'');
      const upstream=await transport(rawUrl(env,`${key}/${suffix}`)+(versioned?`?v=${version}`:''),{signal:AbortSignal.timeout(15000)});
      if(!upstream.ok)return json({error:upstream.status===404?'该城市暂无共享数据。':'共享数据暂时不可用。'},upstream.status===404?404:502);
      return new Response(upstream.body,{status:200,headers:{...cors,
        'Content-Type':binary?'application/octet-stream':'application/json',
        'Cache-Control':binary?'public,max-age=31536000,immutable':'public,max-age=60'}});
    }
    if(request.method==='GET'&&/^\/jobs\/[a-f0-9-]{36}$/.test(path)){
      const job=await env.JOBS.prepare('SELECT * FROM city_jobs WHERE id=?').bind(path.split('/')[2]).first<Job>();
      if(!job)throw fail(404,'没有找到此更新任务。');
      if(!terminal.has(job.state)&&job.expires_at<Date.now()){
        job.state='failed';job.message='更新任务超时，请稍后重试。';
        await env.JOBS.prepare("UPDATE city_jobs SET state='failed',message=?,updated_at=? WHERE id=?").bind(job.message,Date.now(),job.id).run();
      }
      return json(publicJob(job));
    }
    if(request.method!=='POST'||path!=='/jobs')throw fail(404,'没有这个接口。');
    if(!env.JOBS||!env.GITHUB_DISPATCH_TOKEN||!env.RATE_LIMIT_SALT||env.RATE_LIMIT_SALT.length<16||!env.CALLBACK_SECRET||env.CALLBACK_SECRET.length<32)throw fail(503,'城市更新入口尚未配置完成。');
    let body:any;try{body=JSON.parse(await limitedBody(request,1024));}catch(error:any){if(error.status)throw error;throw fail(400,'请求格式无效。');}
    let key:string;try{key=cityDataKey(body.city);}catch{throw fail(400,'城市名称无效。');}
    const now=Date.now();
    const existing=await env.JOBS.prepare('SELECT * FROM city_jobs WHERE city_key=?').bind(key).first<Job>();
    if(existing&&existing.expires_at>now)return json(publicJob(existing),202);
    if(await cityFresh(env,body.city,transport))return json({state:'ready',city:body.city,message:'已有有效共享数据，可以直接加载。'});
    const day=new Date(now).toISOString().slice(0,10),expiry=Date.parse(`${day}T00:00:00Z`)+86400000;
    const ip=await sign(env.RATE_LIMIT_SALT,request.headers.get('CF-Connecting-IP')||'unknown');
    const dailyLimitsEnabled=env.DAILY_UPDATE_LIMITS_ENABLED==='true';
    const globalLimit=Math.max(1,Math.min(100,Number(env.MAX_UPDATES_PER_DAY)||1));
    const globalKey=`global:${day}`,ipKey=`ip:${day}:${ip}`;
    const global=await env.JOBS.prepare('SELECT used FROM request_budgets WHERE bucket=?').bind(globalKey).first<{used:number}>();
    if(dailyLimitsEnabled&&global&&global.used>=globalLimit)throw fail(429,'今日共享更新名额已用完，请明天再试。');
    const id=crypto.randomUUID();
    const claimed=await env.JOBS.prepare(`INSERT INTO city_jobs(city_key,id,city,state,message,created_at,updated_at,expires_at)
      VALUES(?,?,?,'queued','已提交，等待线路更新。',?,?,?) ON CONFLICT(city_key) DO UPDATE SET id=excluded.id,city=excluded.city,
      state=excluded.state,message=excluded.message,created_at=excluded.created_at,updated_at=excluded.updated_at,expires_at=excluded.expires_at,result_json=NULL
      WHERE city_jobs.expires_at<=? RETURNING *`).bind(key,id,body.city,now,now,now+45*60000,now).first<Job>();
    if(!claimed){const joined=await env.JOBS.prepare('SELECT * FROM city_jobs WHERE city_key=?').bind(key).first<Job>();return json(publicJob(joined!),202);}
    if(dailyLimitsEnabled){
    const budgets=await env.JOBS.batch([
      env.JOBS.prepare(`INSERT INTO request_budgets(bucket,used,expires_at,last_id) VALUES(?,1,?,?)
        ON CONFLICT(bucket) DO UPDATE SET used=used+1,last_id=excluded.last_id WHERE request_budgets.used<3 RETURNING used`).bind(ipKey,expiry,id),
      env.JOBS.prepare(`INSERT INTO request_budgets(bucket,used,expires_at,last_id) SELECT ?,1,?,?
        WHERE EXISTS(SELECT 1 FROM request_budgets WHERE bucket=? AND last_id=?)
        ON CONFLICT(bucket) DO UPDATE SET used=used+1,last_id=excluded.last_id WHERE request_budgets.used<? RETURNING used`).bind(globalKey,expiry,id,ipKey,id,globalLimit),
    ]);
    if(!budgets[0].results?.length||!budgets[1].results?.length){await env.JOBS.prepare('DELETE FROM city_jobs WHERE id=?').bind(id).run();throw fail(429,'更新请求过于频繁，请稍后再试。');}
    }
    try{
      const response=await transport(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/update-city-data.yml/dispatches`,{
        method:'POST',headers:{Authorization:`Bearer ${env.GITHUB_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Busline-City-Gateway','Content-Type':'application/json'},
        body:JSON.stringify({ref:env.GITHUB_WORKFLOW_REF||'main',inputs:{city:body.city,request_id:id}}),signal:AbortSignal.timeout(15000),
      });
      if(!response.ok)throw Error('dispatch failed');
    }catch{
      await env.JOBS.prepare("UPDATE city_jobs SET state='failed',message='暂时无法启动更新，请稍后重试。',updated_at=?,expires_at=? WHERE id=?")
        .bind(Date.now(),Date.now()+300000,id).run();
      throw fail(502,'暂时无法启动更新，请检查任务入口配置。');
    }
    await env.JOBS.prepare('DELETE FROM request_budgets WHERE expires_at<?').bind(now).run();
    return json(publicJob(claimed),202);
  }catch(error:any){return json({error:[400,401,403,404,409,413,429,502,503].includes(error.status)?error.message:'城市更新服务暂时不可用。'},error.status||503);}
}
export default {fetch:(request:Request,env:Env)=>handleGateway(request,env)};
