import { cityDataKey } from '../../src/utils/cityDataset';
import type { Env } from './worker';
const MAX=30*1024*1024,CHUNK=256*1024;
const fail=(status:number,message:string)=>Object.assign(Error(message),{status});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const init=new WeakMap<object,Promise<void>>();
export async function uploadSchema(env:Env){
  let promise=init.get(env.JOBS);
  if(!promise){promise=(async()=>{
    await env.JOBS.prepare(`CREATE TABLE IF NOT EXISTS city_uploads(id TEXT PRIMARY KEY,city TEXT NOT NULL,token_hash TEXT NOT NULL,bytes INTEGER NOT NULL,parts INTEGER NOT NULL,sha256 TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL)`).run();
    await env.JOBS.prepare(`CREATE TABLE IF NOT EXISTS city_upload_parts(upload_id TEXT NOT NULL,part INTEGER NOT NULL,body BLOB NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(upload_id,part))`).run();
  })();init.set(env.JOBS,promise);}
  await promise;
}
async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function limitedBytes(request:Request,limit:number){
  if(Number(request.headers.get('Content-Length')||0)>limit)throw fail(413,'上传片段过大。');
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw fail(413,'上传片段过大。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return bytes;
}
export async function cleanCityUpload(env:Env,id:string){
  await uploadSchema(env);
  await env.JOBS.prepare('DELETE FROM city_upload_parts WHERE upload_id=?').bind(id).run();
  await env.JOBS.prepare('DELETE FROM city_uploads WHERE id=?').bind(id).run();
}
export async function handleCityUploads(request:Request,env:Env,transport:typeof fetch){
  await uploadSchema(env);
  const path=new URL(request.url).pathname;
  const match=/^\/uploads\/([a-f0-9-]{36})(?:\/(complete|chunks\/(\d+)))?$/.exec(path);
  if(request.method==='POST'&&path==='/uploads'){
    if(!env.GITHUB_DISPATCH_TOKEN||!env.CALLBACK_SECRET||env.CALLBACK_SECRET.length<32)throw fail(503,'上传入口尚未配置完成，地图仍可正常使用。');
    const input=JSON.parse(new TextDecoder().decode(await limitedBytes(request,1024)));
    const key=cityDataKey(input.city),size=Number(input.bytes),parts=Number(input.parts);
    if(!Number.isInteger(size)||size<2||size>MAX||parts!==Math.ceil(size/CHUNK)||!/^[a-f0-9]{64}$/.test(input.sha256||''))throw fail(400,'上传信息无效或超过30MiB。');
    const now=Date.now();
    await env.JOBS.prepare('DELETE FROM city_upload_parts WHERE upload_id IN (SELECT id FROM city_uploads WHERE expires_at<=?)').bind(now).run();
    await env.JOBS.prepare('DELETE FROM city_uploads WHERE expires_at<=?').bind(now).run();
    const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();
    const claimed=await env.JOBS.prepare(`INSERT INTO city_jobs(city_key,id,city,state,message,created_at,updated_at,expires_at) VALUES(?,?,?,'queued','正在接收本地检索结果。',?,?,?)
      ON CONFLICT(city_key) DO UPDATE SET id=excluded.id,city=excluded.city,state=excluded.state,message=excluded.message,created_at=excluded.created_at,updated_at=excluded.updated_at,expires_at=excluded.expires_at,result_json=NULL
      WHERE city_jobs.expires_at<=? OR city_jobs.state NOT IN ('queued','running') RETURNING id`).bind(key,id,input.city,now,now,now+30*60000,now).first();
    if(!claimed)throw fail(409,'该城市已有上传或保存任务，请稍后再提交。');
    const inserted=await env.JOBS.prepare(`INSERT INTO city_uploads(id,city,token_hash,bytes,parts,sha256,state,expires_at) SELECT ?,?,?,?,?,?,'uploading',? WHERE (SELECT COUNT(*) FROM city_uploads)<8 RETURNING id`)
      .bind(id,input.city,await digest(token),size,parts,input.sha256,now+30*60000).first();
    if(!inserted){await env.JOBS.prepare('DELETE FROM city_jobs WHERE id=?').bind(id).run();throw fail(429,'上传任务繁忙，请稍后重试。');}
    return json({id,token,chunkSize:CHUNK});
  }
  if(!match)throw fail(404,'没有这个上传接口。');
  const [,id,action,index]=match;
  const upload=await env.JOBS.prepare('SELECT * FROM city_uploads WHERE id=?').bind(id).first<any>();
  if(!upload||upload.expires_at<Date.now())throw fail(409,'上传任务已过期，请重新提交。');
  if(request.method==='GET'){
    const at=Number(request.headers.get('x-city-timestamp'));
    if(!Number.isFinite(at)||Math.abs(Date.now()-at)>300000)throw fail(401,'下载认证失败。');
    const signature=request.headers.get('x-city-signature')||'';
    if(!/^[a-f0-9]{64}$/.test(signature))throw fail(401,'下载认证失败。');
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.CALLBACK_SECRET||''),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const message=`${id}:${index===undefined?'manifest':index}:${at}`;
    if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16)),new TextEncoder().encode(message)))throw fail(401,'下载认证失败。');
    if(upload.state!=='queued')throw fail(409,'上传尚未完成。');
    if(index===undefined)return json({id,city:upload.city,bytes:upload.bytes,parts:upload.parts,sha256:upload.sha256});
    const part=await env.JOBS.prepare('SELECT body FROM city_upload_parts WHERE upload_id=? AND part=?').bind(id,Number(index)).first<any>();
    if(!part)throw fail(404,'上传片段不存在。');
    return new Response(new Uint8Array(part.body),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
  }
  const token=request.headers.get('x-city-upload-token')||'';
  if(!token||token.length>200||await digest(token)!==upload.token_hash)throw fail(401,'上传认证失败。');
  if(request.method==='DELETE'){
    if(upload.state!=='uploading')throw fail(409,'结果正在保存，请等待完成。');
    await cleanCityUpload(env,id);
    await env.JOBS.prepare("UPDATE city_jobs SET state='failed',message='上传已取消。',expires_at=? WHERE id=?").bind(Date.now(),id).run();
    return json({cancelled:true});
  }
  if(request.method==='PUT'&&index!==undefined){
    if(upload.state!=='uploading')throw fail(409,'结果已提交保存。');
    const number=Number(index);if(!Number.isInteger(number)||number<0||number>=upload.parts)throw fail(400,'片段编号无效。');
    const bytes=await limitedBytes(request,CHUNK);
    if(bytes.length!==(number===upload.parts-1?upload.bytes-number*CHUNK:CHUNK))throw fail(400,'片段长度不符。');
    await env.JOBS.prepare('INSERT INTO city_upload_parts(upload_id,part,body,bytes) VALUES(?,?,?,?) ON CONFLICT(upload_id,part) DO UPDATE SET body=excluded.body,bytes=excluded.bytes').bind(id,number,bytes.buffer,bytes.length).run();
    return json({received:number});
  }
  if(request.method==='POST'&&action==='complete'){
    if(upload.state==='queued')return json(await env.JOBS.prepare('SELECT * FROM city_jobs WHERE id=?').bind(id).first(),202);
    const received=await env.JOBS.prepare('SELECT COUNT(*) AS parts,COALESCE(SUM(bytes),0) AS bytes FROM city_upload_parts WHERE upload_id=?').bind(id).first<any>();
    if(received.parts!==upload.parts||received.bytes!==upload.bytes)throw fail(409,'上传尚未完整，请重试。');
    const claimed=await env.JOBS.prepare("UPDATE city_uploads SET state='queued',expires_at=? WHERE id=? AND state='uploading' RETURNING id").bind(Date.now()+45*60000,id).first();
    if(!claimed)throw fail(409,'任务已提交，请等待保存。');
    await env.JOBS.prepare("UPDATE city_jobs SET message='上传完成，等待校验并保存到远端。',expires_at=? WHERE id=?").bind(Date.now()+45*60000,id).run();
    let response:Response;
    try{response=await transport(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/update-city-data.yml/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${env.GITHUB_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'Busline-City-Gateway','Content-Type':'application/json'},body:JSON.stringify({ref:env.GITHUB_WORKFLOW_REF||'main',inputs:{city:upload.city,request_id:id,uploaded:true}}),signal:AbortSignal.timeout(15000)});}
    catch{response=new Response(null,{status:502});}
    if(!response.ok){
      await cleanCityUpload(env,id);
      await env.JOBS.prepare("UPDATE city_jobs SET state='failed',message='无法启动远端保存。',expires_at=? WHERE id=?").bind(Date.now(),id).run();
      throw fail(502,'无法启动远端保存，请稍后重新提交；本地地图不受影响。');
    }
    return json({id,city:upload.city,state:'queued',message:'上传完成，等待校验并保存到远端。'},202);
  }
  throw fail(404,'没有这个上传接口。');
}
