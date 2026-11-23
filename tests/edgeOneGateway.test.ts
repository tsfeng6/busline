import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {handleEdgeOneGateway,gatewaySignature,type UploadStore} from '../edgeone/city-gateway/handler';
import {uploadCitySnapshot} from '../src/utils/cityUploadClient';
import {readCityUpload} from '../scripts/read-city-upload';
import {cityBlobHash,CITY_CHUNK_BYTES} from '../src/utils/cityTransfer';
const env={GITHUB_DISPATCH_TOKEN:'fake-test-token',CALLBACK_SECRET:'test-only-callback-secret-1234567890',RATE_LIMIT_SALT:'test-only-rate-salt-12345'};
function fixture(){
 const data=new Map<string,string|ArrayBuffer>(),requests:string[]=[];
 const store:UploadStore={
  async get(key,options){const v=data.get(key);if(v===undefined)return null;if(options?.type==='json')return JSON.parse(String(v));return v;},
  async set(key,value){data.set(key,value);},async delete(key){data.delete(key);},
  async list(options){return {blobs:[...data.keys()].filter(k=>k.startsWith(options?.prefix||'')).map(key=>({key}))};}
 };
 const upstream:typeof fetch=async(input,init)=>{requests.push(String(input));assert.ok(String(input).startsWith('https://api.github.com/repos/tsfeng6/busline/actions/'));const body=JSON.parse(String(init?.body));assert.equal(body.inputs.uploaded,true);return new Response(null,{status:204});};
 const transport:typeof fetch=async(input,init)=>handleEdgeOneGateway(new Request(String(input),init),env,store,upstream);
 const browser:typeof fetch=(input,init)=>transport(input,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:'https://busline.cc'}});
 return {data,store,transport,browser,requests};
}
const sample=()=>({schemaVersion:1,city:'北京市',scope:'city',coverage:'observed',capturedAt:new Date().toISOString(),retrievalComplete:false,filtered:false,
 stops:[{id:'s',name:'站',address:'6路',location:{lng:116.123456789123,lat:39.987654321098}}],
 lines:[{id:'l',name:'6路',city:'北京市',path:[[116.123456789123,39.987654321098],[116.2,39.2]],via_stops:[]}]}) as any;
test('EdgeOne browser upload -> HMAC Actions download preserves exact coordinates without AMap or Cloudflare',async()=>{
 const f=fixture();const original=sample();const job=await uploadCitySnapshot('https://upload.example',original,()=>{},f.browser);
 assert.equal(f.requests.length,1);
 const restored=await readCityUpload(new URL('https://upload.example'),job.id!,original.city,env.CALLBACK_SECRET,f.transport);
 assert.equal(restored.lines[0].path[0][0],original.lines[0].path[0][0]);assert.equal(restored.stops[0].location.lat,original.stops[0].location.lat);
 assert.equal((await f.browser('https://upload.example/jobs/'+job.id)).status,200);
 const raw=JSON.stringify({id:job.id,city:'北京市',state:'completed',message:'已保存',at:Date.now(),result:{promoted:true}});
 const callback=await f.transport('https://upload.example/jobs/callback',{method:'POST',headers:{'x-city-signature':gatewaySignature(env.CALLBACK_SECRET,raw)},body:raw});
 assert.equal(callback.status,200);assert.equal([...f.data.keys()].some(k=>k.startsWith('chunks/')),false);
 const status=await (await f.browser('https://upload.example/jobs/'+job.id)).json();assert.equal(status.state,'completed');assert.ok(!JSON.stringify(status).includes('tokenHash'));
 assert.equal((await f.transport('https://upload.example/jobs/callback',{method:'POST',headers:{'x-city-signature':gatewaySignature(env.CALLBACK_SECRET,raw)},body:raw})).status,200);
});
test('EdgeOne rejects unauthorized origins, forged signatures, oversized manifests and wrong tokens',async()=>{
 const f=fixture();assert.equal((await f.transport('https://upload.example/uploads',{method:'POST',body:'{}'})).status,403);
 assert.equal((await f.browser('https://upload.example/jobs/callback',{method:'POST',body:'{}'})).status,401);
 assert.equal((await f.browser('https://upload.example/uploads',{method:'POST',body:JSON.stringify({city:'北京',bytes:2**31,parts:1,sha256:'a'.repeat(64)})})).status,400);
 assert.equal((await f.browser('https://upload.example/uploads',{method:'POST',body:JSON.stringify({city:'../x'})})).status,400);
 const job=await uploadCitySnapshot('https://upload.example',sample(),()=>{},f.browser);
 assert.equal((await f.browser(`https://upload.example/uploads/${job.id}/chunks/0`,{method:'PUT',headers:{'x-city-upload-token':'wrong'},body:'bad'})).status,401);
 assert.equal((await f.transport(`https://upload.example/uploads/${job.id}`)).status,401);
});
test('EdgeOne validates part lengths, missing parts, retries completion once and blocks expired HMAC',async()=>{
 const f=fixture(),blob=new Blob(['test']);
 const meta={city:'北京',bytes:4,parts:1,sha256:await cityBlobHash(blob),format:'city-records-v1'};
 const created=await(await f.browser('https://upload.example/uploads',{method:'POST',body:JSON.stringify(meta)})).json();
 const base=`https://upload.example/uploads/${created.id}`,headers={'x-city-upload-token':created.token};
 assert.equal(created.chunkSize,CITY_CHUNK_BYTES);
 assert.equal((await f.browser(base+'/complete',{method:'POST',headers})).status,409);
 assert.equal((await f.browser(base+'/chunks/0',{method:'PUT',headers,body:'wrong length'})).status,400);
 assert.equal((await f.browser(base+'/chunks/0',{method:'PUT',headers,body:blob})).status,200);
 assert.equal((await f.browser(base+'/complete',{method:'POST',headers})).status,202);
 assert.equal((await f.browser(base+'/complete',{method:'POST',headers})).status,202);assert.equal(f.requests.length,1);
 const at=Date.now()-600000;assert.equal((await f.transport(base,{headers:{'x-city-timestamp':String(at),'x-city-signature':gatewaySignature(env.CALLBACK_SECRET,`${created.id}:manifest:${at}`)}})).status,401);
});
test('EdgeOne failed dispatch keeps local map intact, reports failure and does not leak secrets',async()=>{
 const f=fixture();const broken:typeof fetch=(input,init)=>handleEdgeOneGateway(new Request(String(input),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:'https://busline.cc'}}),env,f.store,async()=>new Response(null,{status:403}));
 await assert.rejects(uploadCitySnapshot('https://upload.example',sample(),()=>{},broken),/本地地图不受影响/);
 const job=JSON.parse(String([...f.data.entries()].find(([k])=>k.startsWith('jobs/'))![1]));assert.equal(job.state,'failed');
 const response=await broken('https://upload.example/jobs/'+job.id);assert.ok(!(await response.text()).includes(env.GITHUB_DISPATCH_TOKEN));
});

test('EdgeOne expiry, cancellation, browser preflight and best-effort per-IP throttling',async()=>{
 const f=fixture(),blob=new Blob(['test']);
 const request=()=>new Request('https://upload.example/uploads',{method:'POST',headers:{Origin:'https://busline.cc'},body:JSON.stringify({city:'北京',bytes:4,parts:1,sha256:'a'.repeat(64)})});
 const first=await handleEdgeOneGateway(request(),env,f.store,fetch,'192.0.2.1');const session=await first.json();assert.equal(first.status,200);
 assert.equal((await handleEdgeOneGateway(request(),env,f.store,fetch,'192.0.2.1')).status,429);
 assert.equal((await f.browser(`https://upload.example/uploads/${session.id}`,{method:'DELETE',headers:{'x-city-upload-token':session.token}})).status,200);
 assert.ok(!f.data.has(`sessions/${session.id}.json`));
 const preflight=await f.browser('https://upload.example/uploads',{method:'OPTIONS'});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://busline.cc');
 const next=await (await f.browser('https://upload.example/uploads',{method:'POST',body:JSON.stringify({city:'北京',bytes:4,parts:1,sha256:await cityBlobHash(blob)})})).json();
 const key=`sessions/${next.id}.json`,stored=JSON.parse(String(f.data.get(key)));stored.expires=0;f.data.set(key,JSON.stringify(stored));
 assert.equal((await f.browser(`https://upload.example/uploads/${next.id}/chunks/0`,{method:'PUT',headers:{'x-city-upload-token':next.token},body:blob})).status,409);
});

test('EdgeOne Actions reader rejects payload hash tampering before publication',async()=>{
 const f=fixture();const job=await uploadCitySnapshot('https://upload.example',sample(),()=>{},f.browser);
 const key=`chunks/${job.id}/0`,part=new Uint8Array(f.data.get(key) as ArrayBuffer);part[0]^=1;f.data.set(key,part.buffer);
 await assert.rejects(readCityUpload(new URL('https://upload.example'),job.id!,'北京市',env.CALLBACK_SECRET,f.transport));
});

test('Node function request adapters without a Web stream body can submit valid manifests',async()=>{
 const f=fixture();
 const raw=JSON.stringify({city:'北京',bytes:2,parts:1,sha256:'a'.repeat(64)});
 const request={url:'https://upload.example/uploads',method:'POST',headers:new Headers({Origin:'https://busline.cc','Content-Length':String(Buffer.byteLength(raw))}),body:undefined,arrayBuffer:async()=>new TextEncoder().encode(raw).buffer} as unknown as Request;
 const response=await handleEdgeOneGateway(request,env,f.store);
 assert.equal(response.status,200);assert.ok((await response.json()).token);
});

test('WeChat callback verifies its signature and issues only a one-time registration link',async()=>{
 const data=new Map<string,string|ArrayBuffer>(),store:UploadStore={async get(){return null;},async set(){},async delete(){},async list(){return {blobs:[]};}};
 const wechatEnv={...env,SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',WECHAT_CALLBACK_TOKEN:'wechat-callback-test-token',PUBLIC_APP_URL:'https://busline.cc',PUBLIC_GATEWAY_URL:'https://gateway.busline.cc'};
 const transport:typeof fetch=async(input,init)=>{
   const path=new URL(String(input)).pathname;
   if(path.endsWith('/claim_wechat_inbound'))return new Response('true',{headers:{'Content-Type':'application/json'}});
   if(path==='/rest/v1/wechat_bindings')return new Response('[]',{headers:{'Content-Type':'application/json'}});
   if(path==='/auth/v1/admin/users')return new Response('{"id":"00000000-0000-0000-0000-000000000001"}',{headers:{'Content-Type':'application/json'}});
   if(path==='/rest/v1/wechat_bindings'||path==='/rest/v1/game_profiles')return new Response('{}',{headers:{'Content-Type':'application/json'}});
   throw Error('unexpected upstream '+path);
 };
 const timestamp=String(Math.floor(Date.now()/1000)),nonce='nonce-1',signature=createHash('sha1').update([wechatEnv.WECHAT_CALLBACK_TOKEN!,timestamp,nonce].sort().join('')).digest('hex');
 const raw='<xml><ToUserName><![CDATA[busline]]></ToUserName><FromUserName><![CDATA[openid-123]]></FromUserName><CreateTime>1</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[注册账号]]></Content><MsgId>42</MsgId></xml>';
 const response=await handleEdgeOneGateway(new Request(`https://gateway.example/wechat/callback?timestamp=${timestamp}&nonce=${nonce}&signature=${signature}`,{method:'POST',body:raw}),wechatEnv,store,transport);
 assert.equal(response.status,200);const body=await response.text();assert.match(body,/注册成功/);assert.match(body,/登录 \+ 8位登录码/);
 assert.equal((await handleEdgeOneGateway(new Request('https://gateway.example/wechat/callback?timestamp='+timestamp+'&nonce='+nonce+'&signature=bad',{method:'POST',body:raw}),wechatEnv,store,transport)).status,401);
});
