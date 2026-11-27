import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {handleEdgeOneGateway,gatewaySignature,type UploadStore} from '../edgeone/city-gateway/handler';
import {uploadCitySnapshot} from '../src/utils/cityUploadClient';
import {readCityUpload} from '../scripts/read-city-upload';
import {cityBlobHash,CITY_CHUNK_BYTES} from '../src/utils/cityTransfer';
const env={GITHUB_DISPATCH_TOKEN:'fake-test-token',CALLBACK_SECRET:'test-only-callback-secret-1234567890',RATE_LIMIT_SALT:'test-only-rate-salt-12345',ADMIN_PASSWORD:'buslineadmin',ADMIN_SESSION_SECRET:'test-only-admin-session-secret'};
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

test('session restore rejects anonymous and empty profiles, and resolves IDs for old profile RPCs', async () => {
 const {store} = fixture();
 const accountEnv = {...env, SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'test-key'};
 const id = '00000000-0000-0000-0000-000000000001';
 const paths: string[] = [];
 let profile: unknown = [];
 const upstream: typeof fetch = async input => {
   const path = new URL(String(input)).pathname;
   paths.push(path);
   return Response.json(path === '/auth/v1/user' ? {id} : profile);
 };
 const restore = (cookie?: string) => handleEdgeOneGateway(new Request('https://gateway.example/game-auth/me', {
   headers: cookie ? {Cookie: 'busline_game_session=' + cookie} : {},
 }), accountEnv, store, upstream);
 assert.equal((await restore()).status, 401);
 assert.deepEqual(paths, []);
 assert.equal((await restore('test-session')).status, 401);
 profile = [{id, display_name:'测试用户'}];
 paths.length = 0;
 assert.deepEqual(await (await restore('test-session')).json(), {account:{id, displayName:'测试用户'}});
 assert.deepEqual(paths, ['/rest/v1/rpc/current_game_profile']);
 profile = [{display_name:'旧版用户'}];
 assert.deepEqual(await (await restore('test-session')).json(), {account:{id, displayName:'旧版用户'}});
 assert.equal(paths.at(-1), '/auth/v1/user');
 const logout = await handleEdgeOneGateway(new Request('https://gateway.example/game-auth/logout',{method:'POST'}), accountEnv, store, upstream);
 assert.match(logout.headers.get('Set-Cookie') || '', /busline_game_session=;.*Max-Age=0/);
 assert.equal((await restore()).status, 401);
});
test('password login and callback return the verified profile with the session cookie', async () => {
 const {store} = fixture();
 const accountEnv = {...env, SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'test-key'};
 const id = '00000000-0000-0000-0000-000000000001';
 const paths: string[] = [];
 let profile: unknown[] = [{display_name:'测试用户'}];
 const upstream: typeof fetch = async (input, init) => {
   const path = new URL(String(input)).pathname;
   paths.push(path);
   if (path === '/auth/v1/token') return Response.json({access_token:'test-token', user:{id}});
   assert.equal(path, '/rest/v1/rpc/current_game_profile');
   assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
   return Response.json(profile);
 };
 const signIn = (path: string, init: RequestInit) => handleEdgeOneGateway(
   new Request('https://gateway.example/game-auth/' + path, {...init, method:'POST'}), accountEnv, store, upstream,
 );
 const password = () => signIn('password-login', {body:JSON.stringify({accountName:'test_user', password:'test-password'})});
 const callback = () => signIn('session', {headers:{Authorization:'Bearer test-token'}});
 const result = await password();
 assert.deepEqual(await result.json(), {signedIn:true, account:{id, displayName:'测试用户'}});
 assert.match(result.headers.get('Set-Cookie') || '', /busline_game_session=test-token;.*Secure; HttpOnly/);
 assert.deepEqual(paths.splice(0), ['/auth/v1/token', '/rest/v1/rpc/current_game_profile']);
 profile = [{id, display_name:'测试用户'}];
 const exchanged = await callback();
 assert.deepEqual(await exchanged.json(), {signedIn:true, account:{id, displayName:'测试用户'}});
 assert.ok(exchanged.headers.has('Set-Cookie'));
 assert.deepEqual(paths.splice(0), ['/rest/v1/rpc/current_game_profile']);
 profile = [];
 const denied = await callback();
 assert.equal(denied.status, 401);
 assert.equal(denied.headers.has('Set-Cookie'), false);
});

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
test('EdgeOne verifies the admin key at the gateway and throttles incorrect attempts',async()=>{
 const f=fixture(),request=(password:string)=>new Request('https://gateway.example/admin/verify',{method:'POST',headers:{Origin:'https://busline.cc','Content-Type':'application/json'},body:JSON.stringify({password})});
 assert.equal((await handleEdgeOneGateway(request('incorrect'),env,f.store,fetch,'192.0.2.9')).status,401);
 const accepted=await handleEdgeOneGateway(request('buslineadmin'),env,f.store,fetch,'192.0.2.9');assert.equal(accepted.status,200);const body=await accepted.json();assert.ok(body.sessionToken);assert.equal(body.expiresIn,21600000);
 for(let i=0;i<5;i++)assert.equal((await handleEdgeOneGateway(request('incorrect'),env,f.store,fetch,'192.0.2.10')).status,401);
 assert.equal((await handleEdgeOneGateway(request('buslineadmin'),env,f.store,fetch,'192.0.2.10')).status,429);
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

test('WeChat callback verifies its signature and sends first-time users a registration link',async()=>{
 const data=new Map<string,string|ArrayBuffer>(),store:UploadStore={async get(){return null;},async set(){},async delete(){},async list(){return {blobs:[]};}};
 const wechatEnv={...env,SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',WECHAT_CALLBACK_TOKEN:'wechat-callback-test-token',PUBLIC_APP_URL:'https://busline.cc',PUBLIC_GATEWAY_URL:'https://gateway.busline.cc'};
 const transport:typeof fetch=async(input,init)=>{
   const path=new URL(String(input)).pathname;
   if(path.endsWith('/claim_wechat_inbound'))return new Response('true',{headers:{'Content-Type':'application/json'}});
   if(path==='/rest/v1/wechat_bindings')return new Response('[]',{headers:{'Content-Type':'application/json'}});
   if(path==='/rest/v1/rpc/create_wechat_link_token'||path==='/rest/v1/wechat_link_tokens')return new Response('{}',{headers:{'Content-Type':'application/json'}});
   if(path==='/auth/v1/admin/users')return new Response('{"id":"00000000-0000-0000-0000-000000000001"}',{headers:{'Content-Type':'application/json'}});
   if(path==='/rest/v1/wechat_bindings'||path==='/rest/v1/game_profiles')return new Response('{}',{headers:{'Content-Type':'application/json'}});
   throw Error('unexpected upstream '+path);
 };
 const timestamp=String(Math.floor(Date.now()/1000)),nonce='nonce-1',signature=createHash('sha1').update([wechatEnv.WECHAT_CALLBACK_TOKEN!,timestamp,nonce].sort().join('')).digest('hex');
 const raw='<xml><ToUserName><![CDATA[busline]]></ToUserName><FromUserName><![CDATA[openid-123]]></FromUserName><CreateTime>1</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[注册账号]]></Content><MsgId>42</MsgId></xml>';
 const response=await handleEdgeOneGateway(new Request(`https://gateway.example/wechat/callback?timestamp=${timestamp}&nonce=${nonce}&signature=${signature}`,{method:'POST',body:raw}),wechatEnv,store,transport);
 assert.equal(response.status,200);const body=await response.text();assert.match(body,/完成注册/);assert.match(body,/wechat=register&token=/);assert.doesNotMatch(body,/&amp;token=/);
 assert.equal((await handleEdgeOneGateway(new Request('https://gateway.example/wechat/callback?timestamp='+timestamp+'&nonce='+nonce+'&signature=bad',{method:'POST',body:raw}),wechatEnv,store,transport)).status,401);
});

test('ranked gateway exposes only the drawing until the server grades the answer', async () => {
 const {store} = fixture();
 const id = '00000000-0000-0000-0000-000000000001', run = '00000000-0000-0000-0000-000000000002';
 const questionId = '00000000-0000-0000-0000-000000000003';
 const accountEnv = {...env, SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'anon-test-key',
  SUPABASE_SECRET_KEY:'sb_secret_test', PUBLIC_APP_URL:'https://busline.cc'};
 const state: Record<string, any> = { game:'city', difficulty:'hard', scope:'全国', number:0, previousAnswer:'', hints:0, remainingMs:180000 };
 let cityReads = 0, stateReads = 0;
 const upstream: typeof fetch = async (input, init) => {
   const url = new URL(String(input));
   if (url.pathname === '/rest/v1/rpc/current_game_profile') return Response.json([{id, display_name:'测试用户'}]);
   if (url.hostname === 'busline.cc') {
     cityReads++;
     assert.equal(new Headers(init?.headers).has('Authorization'), false);
     if (url.pathname.endsWith('.png')) return new Response(Uint8Array.from([137,80,78,71,13,10,26,10]));
     return Response.json(url.pathname.endsWith('overview.json') ?
       { cities:[{city:'北京市', bounds:[115,38,117,41], thumbnail:'thumbnails/北京.png'}] } : sample());
   }
   assert.equal(url.pathname, '/rest/v1/rpc/ranked_game_action');
   assert.equal(new Headers(init?.headers).get('apikey'), 'sb_secret_test');
   const { p_user, p_action, p_input } = JSON.parse(String(init?.body));
   assert.equal(p_user, id);
   if (p_action === 'start') {
     assert.equal(p_input.rules.multiplier, 5);
     assert.deepEqual(p_input.rules.tags, ['fill']);
     state.rules = p_input.rules;
     return Response.json({id:run, game:p_input.game, scope:p_input.scope, difficulty:p_input.difficulty});
   }
   if (p_action === 'read') { stateReads++; return Response.json(state); }
   if (p_action === 'issue') {
     Object.assign(state, { id:questionId, number:p_input.number, question:p_input.question, drawing:p_input.drawing });
     return Response.json(state);
   }
   if (p_action === 'answer') {
     assert.equal(p_input.correct, true);
     assert.equal(p_input.score, undefined);
     assert.equal(p_input.id, questionId);
     return Response.json({ question:state.question, number:1, answer:p_input.answer, correct:true, timedOut:false, score:5, finished:false });
   }
   throw Error('unexpected action');
 };
 const post = (path: string, body: unknown) => handleEdgeOneGateway(new Request('https://gateway.example' + path, {
   method:'POST', headers:{Cookie:'busline_game_session=test-session'}, body:JSON.stringify(body),
 }), accountEnv, store, upstream);
 assert.equal((await post('/ranked-game-runs', { game:'line', scope:'广州市' })).status, 400);
 assert.equal((await post('/ranked-game-runs', { game:'station', scope:'上海市', tags:['fill','nearby'] })).status, 400);
 assert.equal((await post('/ranked-game-runs', { game:'city', tags:['fill'], multiplier:999 })).status, 201);
 const prefix = '/ranked-game-runs/' + run;
 const packed = await post(prefix + '/pack', {number:1});
 assert.equal(packed.status, 200);
 assert.equal(packed.headers.get('cache-control'), 'no-store');
 const textOfPack = await packed.text();
 assert.doesNotMatch(textOfPack, /correctAnswer|targetCity|北京市/);
 const { ticket } = JSON.parse(textOfPack);
 const readsAfterPrepare = cityReads;
 assert.ok(readsAfterPrepare > 0);
 assert.equal((await post(prefix + '/question', {number:1, ticket:(ticket[0] === 'A' ? 'B' : 'A') + ticket.slice(1)})).status, 400);
 const response = await post(prefix + '/question', {number:1, ticket});
 assert.equal(cityReads, readsAfterPrepare);

 assert.equal(response.status, 200);
 assert.equal(response.headers.get('cache-control'), 'no-store');
 const text = await response.text();
 assert.doesNotMatch(text, /correctAnswer|targetCity|fallbackCenter|116\.123456789123|北京市/);
 assert.match(JSON.parse(text).drawing.raster, /^iVBORw0KGgo/);
 const next = await post(prefix + '/pack', {number:2});
 assert.equal(next.status, 200);
 assert.equal(state.number, 1);
 assert.equal(state.id, questionId);
 const settled = await post('/ranked-game-runs/' + run + '/answer', {id:questionId, answer:'北京市', score:999});
 assert.equal((await settled.json()).score, 5);
 Object.assign(state, { number: 10, question: null, previousAnswer: '北京市' });
 const latePack = await post(prefix + '/pack', {number:11});
 assert.equal(latePack.status, 200);
 const late = await latePack.json();
 assert.equal((await post(prefix + '/question', {number:11, ticket})).status, 400);
 assert.equal((await post(prefix + '/question', {number:11, ticket:late.ticket})).status, 200);
 // The new client receives only timer metadata and independently builds its local question.
 const { createSimulationQuestion, rankedQuestionRandom } = await import('../src/utils/simulationQuestion');
 const { normalizeQuizCatalog } = await import('../src/utils/cityOverview');
 const catalog = normalizeQuizCatalog([{city:'北京市', bounds:[115,38,117,41], thumbnail:'thumbnails/北京.png'}]);
 const { contestRules } = await import('../src/utils/contestRules');
 const local = await createSimulationQuestion('city', '', '', contestRules('city', ['fill']), '', catalog,
    async () => { throw Error('不应加载全量城市数据'); }, new AbortController().signal, rankedQuestionRandom(run, 1), async () => 'test-image');
 Object.assign(state, { number:0, question:null, previousAnswer:'' });
 const started = await post('/ranked-game-runs', { game:'city', tags:['fill'], browserQuestions:true });
 assert.equal((await started.json()).run.browserQuestions, true);
 const localPacked = await post(prefix + '/pack', {number:1});
 assert.equal(localPacked.status, 200);
 const verifier = (await localPacked.json()).ticket;
 assert.equal((await post(prefix + '/question', {number:1, ticket:verifier, sourceRevision:'stale'})).status, 409);
 const timed = await post(prefix + '/question', {number:1, ticket:verifier, sourceRevision:local.sourceRevision});
 assert.equal(timed.status, 200);
 const metadata = await timed.text();
 assert.doesNotMatch(metadata, /correctAnswer|targetCity|北京市|test-image/);
 assert.equal(state.question.correctAnswer, verifier);
 assert.equal(state.question.encrypted, true);
 assert.equal((await post(prefix + '/pack', {number:2})).status, 200);
 const { answerTicket } = JSON.parse(metadata);
 assert.match(answerTicket, /^[A-Za-z0-9_-]+$/);
 const { openAnswer } = await import('../edgeone/city-gateway/questionTicket');
 assert.throws(() => openAnswer(answerTicket, accountEnv.SUPABASE_SECRET_KEY, run, id, run));
 assert.throws(() => openAnswer(answerTicket, accountEnv.SUPABASE_SECRET_KEY, run, run, questionId));
 const readsBeforeAnswer = stateReads;
 const verified = await post(prefix + '/answer', { id:questionId, answer:local.correctAnswer, score:999, answerTicket });
 assert.equal(stateReads, readsBeforeAnswer);
 const verifiedBody = await verified.json();
 assert.equal(verifiedBody.correct, true);
 assert.equal(verifiedBody.question.correctAnswer, local.correctAnswer);
 Object.assign(state, { number:1, question:null, previousAnswer:verifier });
 assert.equal((await post(prefix + '/pack', {number:2})).status, 200);
 assert.equal((await post('/game-runs/' + run + '/finish', {score:999})).status, 410);
});

test('S1 county standings use the Hebei contest scope', async () => {
 const {store} = fixture();
 const accountEnv = {...env, SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'test-key'};
 const calls: unknown[] = [];
 const upstream: typeof fetch = async (_input, init) => {
   calls.push(JSON.parse(String(init?.body)));
   return Response.json([]);
 };
 const board = (scope: string) => handleEdgeOneGateway(new Request(
   'https://gateway.example/contest-leaderboards?' + new URLSearchParams({game:'county', scope}),
 ), accountEnv, store, upstream);
 assert.equal((await board('河南省')).status, 400);
 assert.deepEqual(await (await board('河北省')).json(), {entries:[]});
 assert.deepEqual(calls, [{p_game:'county', p_scope:'河北省'}]);
});

test('local contest results save the best score for the authenticated player', async () => {
 const {store} = fixture();
 const id = '00000000-0000-0000-0000-000000000001';
 const accountEnv = {...env, SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'test-key', SUPABASE_SECRET_KEY:'sb_secret_test'};
 let suspended = false;
 const best = new Map<string, number>();
 const upstream: typeof fetch = async (input, init) => {
   const url = new URL(String(input));
   if (url.pathname.endsWith('/current_game_profile')) return Response.json([{id, display_name:'测试用户'}]);
   assert.equal(new Headers(init?.headers).get('apikey'), 'sb_secret_test');
   if (url.pathname.endsWith('/game_contest_suspensions')) {
     assert.equal(url.searchParams.get('user_id'), 'eq.' + id);
     return Response.json(suspended ? [{user_id:id}] : []);
   }
   assert.equal(url.pathname, '/rest/v1/game_contest_entries');
   const entry = JSON.parse(String(init?.body));
   if (init?.method === 'POST') {
     assert.equal(entry.user_id, id);
     assert.equal(entry.scope, '北京市');
     if (best.has(entry.game)) return Response.json([]);
     best.set(entry.game, entry.score);
     return Response.json([{score:entry.score}]);
   }
   assert.equal(init?.method, 'PATCH');
   assert.equal(url.searchParams.get('user_id'), 'eq.' + id);
   assert.equal(url.searchParams.get('score'), 'lt.' + entry.score);
   const game = url.searchParams.get('game')!.slice(3);
   if (entry.score > best.get(game)!) best.set(game, entry.score);
   return new Response(null, {status:204});
 };
 const submit = (correctCount: number, cookie = 'busline_game_session=session', game = 'line', tags = ['all-city']) =>
   handleEdgeOneGateway(new Request('https://gateway.example/contest-results', {
     method:'POST', headers:{Cookie:cookie},
     body:JSON.stringify({game,scope:'北京市',tags,correctCount,score:999999}),
   }), accountEnv, store, upstream);
 assert.equal((await submit(4, '')).status, 401);
 assert.equal((await submit(-1)).status, 400);
 assert.deepEqual(await (await submit(4)).json(), {saved:true});
 assert.equal(best.get('line'), 4);
 assert.equal((await submit(2)).status, 200);
 assert.equal(best.get('line'), 4);
 assert.equal((await submit(5)).status, 200);
 assert.equal(best.get('line'), 5);
 assert.equal((await submit(4, undefined, 'station', [])).status, 200);
 assert.equal((await submit(3, undefined, 'accessibility', ['medium-stops', 'time-300'])).status, 200);
 assert.equal(best.get('station'), 2);
 assert.equal(best.get('accessibility'), 6);
 suspended = true;
 assert.equal((await submit(8)).status, 403);
 assert.equal(best.get('line'), 5);
});

test('contest labels are exclusive and only valid for their mode', async () => {
  const { contestRules } = await import('../src/utils/contestRules');
  assert.equal(contestRules('line', []).multiplier, 0.5);
  assert.equal(contestRules('station', []).multiplier, 0.5);
  assert.equal(contestRules('line', ['special']).multiplier, 1);
  assert.equal(contestRules('line', ['niche']).multiplier, 1.5);
  assert.equal(contestRules('line', ['unusual']).multiplier, 2);
  assert.equal(contestRules('line', ['unlimited']).multiplier, 2.5);
  assert.equal(contestRules('line', []).showBasemap, true);
  assert.equal(contestRules('line', ['network-only']).showBasemap, false);
  assert.equal(contestRules('line', ['network-only']).multiplier, 1.5);
  assert.equal(contestRules('line', ['no-base']).showBasemap, false);
  for (const mode of ['line', 'station', 'accessibility'] as const) {
    assert.equal(contestRules(mode, ['all-city']).multiplier, 1);
  }
  assert.equal(contestRules('accessibility', ['all-city', 'medium-stops', 'time-300']).multiplier, 4);
  assert.throws(() => contestRules('station', ['no-base']), /无效/);
  assert.throws(() => contestRules('station', ['no-stops']), /无效/);
  assert.throws(() => contestRules('accessibility', ['network-only']), /无效/);
  assert.equal(contestRules('accessibility', []).timeLimit, 600);
  assert.equal(contestRules('accessibility', []).minStationRoutes, 10);
  assert.equal(contestRules('accessibility', ['medium-stops']).minStationRoutes, 5);
  assert.equal(contestRules('accessibility', ['all-stops']).minStationRoutes, 1);
  assert.equal(contestRules('station', ['hints-3', 'time-10']).hintLimit, 3);
  assert.equal(contestRules('station', ['hints-3', 'time-10']).timeLimit, 10);
  assert.equal(contestRules('county', ['fill']).multiplier, 5);
  assert.throws(() => contestRules('line', ['time-5', 'time-10']), /每组/);
  assert.throws(() => contestRules('line', ['network-only', 'no-base']), /每组/);
  assert.throws(() => contestRules('line', ['unusual', 'unlimited']), /每组/);
  assert.throws(() => contestRules('station', ['cycle']), /无效/);
  assert.throws(() => contestRules('city', ['no-base']), /无效/);
});

test('station modes share the 700-meter distractor rule and use separate contest boards', async () => {
  const { contestRules, contests } = await import('../src/utils/contestRules');
  const { createLocalContestQuestion } = await import('../src/utils/contestQuestions');
  const { getContestTotalTime } = await import('../src/utils/gameTimer');
  const locations = [
    ['中心站', 116.1], ['过近站', 116.101], ['候选甲', 116.11],
    ['候选乙', 116.112], ['候选丙', 116.114], ['较远站', 116.116],
  ] as const;
  const lines = locations.map(([name, lng], index) => ({
    ...sample().lines[0], id: String(index), name: `${index + 1}路`,
    path: [[116.1, 39.8], [lng + .001, 39.8]] as [number, number][],
    via_stops: [{ name: '中心站', location: { lng: 116.1, lat: 39.8 } },
      { name, location: { lng, lat: 39.8 } }],
  }));
  const districts: [number, number][][][] = [[[[116,39.7],[116.5,39.7],[116.5,39.9],[116,39.9],[116,39.7]]]];
  const data = { ...sample(), lines };
  const random = () => .999;
  const station = createLocalContestQuestion('station', data, contestRules('station', ['nearby']), districts, '', random);
  assert.equal(station.correctAnswer, '中心站');
  assert.deepEqual(station.options, ['中心站', '候选甲', '候选乙', '候选丙']);
  assert.equal(station.lineInfos, undefined);
  assert.throws(() => createLocalContestQuestion('accessibility', data, contestRules('accessibility', []), districts, '', random), /暂无足够/);
  const accessibility = createLocalContestQuestion('accessibility', data,
    contestRules('accessibility', ['medium-stops', 'nearby']), districts, '', random);
  assert.deepEqual(accessibility.options, station.options);
  assert.equal(accessibility.lineInfos?.length, 6);
  assert.equal(accessibility.showBasemap, false);
  const { drawContestQuestion } = await import('../src/utils/contestDrawing');
  const firstLine = lines[0];
  const drawing = drawContestQuestion({
    ...accessibility,
    lineInfos: [...lines, { ...firstLine, name: '1路(终点--中心站)', path: [...firstLine.path].reverse() }],
  }, 'accessibility');
  assert.equal(drawing.coloredRoutes?.length, 7);
  assert.equal(new Set(drawing.coloredRoutes?.map(route => route.color)).size, 6);
  assert.equal(drawing.coloredRoutes?.[0].color, drawing.coloredRoutes?.at(-1)?.color);
  assert.equal(getContestTotalTime('accessibility', false), 3600);
  assert.equal(getContestTotalTime('accessibility', true), 3600);
  assert.equal(getContestTotalTime('station', true), 1200);
  assert.deepEqual(contests.filter(contest => contest.game === 'station' || contest.game === 'accessibility')
    .map(({ game, scope }) => [game, scope]), [
    ['station', '北京市'], ['station', '上海市'],
    ['accessibility', '北京市'], ['accessibility', '上海市'],
  ]);
});

test('contest question scope, nearby choices and diagram layers follow server rules', async () => {
  const { contestRules } = await import('../src/utils/contestRules');
  const { createLocalContestQuestion } = await import('../src/utils/contestQuestions');
  const { drawContestQuestion } = await import('../src/utils/contestDrawing');
  const line = (name: string, points: [number, number][]) => ({
    ...sample().lines[0], id: name, name, path: points,
    via_stops: points.map(([lng, lat], index) => ({ id: name + index,
      name: index === 0 ? '中心站' : name + '终点', location: { lng, lat } })),
  });
  const data = { ...sample(), lines: [
    line('1路', [[116.1,39.8],[116.2,39.8]]), line('2路', [[116.1,39.8],[116.3,39.8]]),
    line('3路', [[116.1,39.8],[116.9,39.8]]), line('专10路', [[116.1,39.8],[116.2,39.81]]),
  ] };
  const districts: [number, number][][][] = [[[[116,39.7],[116.5,39.7],[116.5,39.9],[116,39.9],[116,39.7]]]];
  const random = () => .999;
  const question = createLocalContestQuestion('line', data, contestRules('line', ['nearby']), districts, '', random);
  assert.equal(question.correctAnswer, '1路');
  assert.deepEqual(question.options, ['1路','2路']);
  assert.ok(drawContestQuestion(question, 'line').arrows?.length);
  assert.ok(drawContestQuestion(question, 'line').basemap);

  const lengthPool = { ...data, lines: [
    line('4路', [[116.1,39.8],[116.15,39.8]]),
    line('5路', [[116.1,39.8],[116.16,39.8],[116.1,39.8]]),
    line('6路', [[116.8,39.8],[116.85,39.8]]),
    ...data.lines,
  ] };
  const guessByLength = (tags: string[]) =>
    createLocalContestQuestion('line', lengthPool, contestRules('line', tags), districts, '', random);
  assert.equal(guessByLength([]).correctAnswer, '5路');
  assert.deepEqual(guessByLength([]).options, ['5路', '1路', '2路']);
  assert.deepEqual(guessByLength(['all-city']).options, ['5路', '1路', '2路', '3路']);
  assert.equal(guessByLength(['special']).correctAnswer, '4路');
  const shortSuburb = { ...data, lines: [lengthPool.lines[2]] };
  assert.throws(() => createLocalContestQuestion('line', shortSuburb,
    contestRules('line', ['all-city', 'fill']), districts, '', random), /暂无足够/);
  assert.equal(createLocalContestQuestion('line', shortSuburb,
    contestRules('line', ['all-city', 'special', 'fill']), districts, '', random).correctAnswer, '6路');

  const unusual = { ...line('观光环线', [[116.7,39.8],[116.9,39.9]]), via_stops: [] };
  const unrestrictedData = { ...data, lines: [unusual, ...data.lines] };
  const unrestricted = createLocalContestQuestion('line', unrestrictedData, contestRules('line', ['unusual', 'all-city', 'nearby']), districts, '', random);
  assert.equal(unrestricted.correctAnswer, '观光环线');
  assert.ok(drawContestQuestion(unrestricted, 'line').arrows?.length);

  const core = [[116.1,39.8],[116.2,39.8]] as [number, number][];
  const outskirts = [[116.8,39.8],[116.9,39.8]] as [number, number][];
  const rail = ['地铁1号线', '市郊铁路S2线', '机场联络线', '磁悬浮', 'G123'].map(name => line(name, core));
  const mixed = { ...data, lines: [
    ...rail, line('观光环线', core), line('假日5路', core), line('快速直达专线187路', core), line('X107路', outskirts), line('兴33路', core),
  ] };
  const guess = (tag: string) => createLocalContestQuestion('line', mixed, contestRules('line', [tag,'fill']), districts, '', random);
  assert.equal(guess('special').correctAnswer, '兴33路');
  assert.equal(guess('all-city').correctAnswer, 'X107路');
  for (const tag of ['special', 'niche', 'unusual', 'unlimited']) {
    const onlySuburb = { ...mixed, lines: [line('X107路', outskirts)] };
    assert.throws(() => createLocalContestQuestion('line', onlySuburb, contestRules('line', [tag, 'fill']), districts, '', random), /暂无足够/);
    assert.equal(createLocalContestQuestion('line', onlySuburb, contestRules('line', [tag, 'all-city', 'fill']), districts, '', random).correctAnswer, 'X107路');
  }
  assert.equal(guess('niche').correctAnswer, '假日5路');
  assert.equal(guess('unusual').correctAnswer, '观光环线');
  assert.equal(guess('unusual').contextPaths?.length, mixed.lines.length);

  const variants = [
    '631快', '密25（河西）(密云鼓楼南站--河西三站)', '840区间', '840路区间车(甲--乙)', '41A', '31路支线',
    '574路(工作日高峰期间)(南营东站--地铁张郭庄站)', '574路(工作日6:00--9:00)(南营东站--地铁张郭庄站)',
  ];
  const loopData = { ...data, lines: [
    ...variants.map(name => line(name, core)),
    line('环一线外环', core),
    line('1路(甲(东门)--乙)', core),
  ] };
  for (const range of [[], ['special'], ['all-city'], ['niche'], ['unusual']]) {
    const result = createLocalContestQuestion('line', loopData, contestRules('line', range), districts, '', random);
    assert.equal(result.correctAnswer, '环一线外环');
    assert.deepEqual(result.options, ['环一线外环', '1路']);
    assert.equal(result.contextPaths?.length, loopData.lines.length);
  }
  const loopStation = createLocalContestQuestion('station', loopData, contestRules('station', ['fill']), districts, '', random);
  assert.equal(loopStation.lineInfos, undefined);

  const { isGameAnswerCorrect } = await import('../src/utils/gameAnswers');
  const { contestRouteEndpoints } = await import('../src/utils/contestRouteName');
  assert.deepEqual(contestRouteEndpoints(variants[6]), { start: '南营东站', end: '地铁张郭庄站' });
  assert.deepEqual(contestRouteEndpoints(variants[1]), { start: '密云鼓楼南站', end: '河西三站' });
  const openPool = { ...data, lines: [line('密25（河西）(甲(东门)--乙)', outskirts), rail[0], line('840区间', core)] };
  const open = createLocalContestQuestion('line', openPool, contestRules('line', ['unlimited', 'all-city']), districts, '', random);
  assert.equal(open.correctAnswer, '密25（河西）');
  assert.deepEqual(open.options, ['密25（河西）', '地铁1号线', '840区间']);
  assert.equal(isGameAnswerCorrect('密25(河西)', open.correctAnswer, true, 'line', true), true);
  assert.equal(isGameAnswerCorrect('密25', open.correctAnswer, true, 'line', true), false);

  const station = createLocalContestQuestion('station', data, contestRules('station', []), districts, '', random);
  const drawing = drawContestQuestion(station, 'station');
  assert.equal(station.correctAnswer, '中心站');
  assert.equal(drawing.frames, undefined);
  assert.ok(drawing.target);
  assert.deepEqual(drawing.terminals, []);
  assert.equal(drawing.path, '');
  assert.deepEqual(drawing.stops, []);
  assert.equal(station.showBasemap, true);
  assert.ok(drawing.basemap);
  const networkOnly = createLocalContestQuestion('station', data, contestRules('station', ['network-only']), districts, '', random);
  assert.equal(networkOnly.showBasemap, false);
  assert.ok(drawContestQuestion(networkOnly, 'station').basemap);

  const { basemap } = drawContestQuestion({
    ...question, networkPaths: [[[0, 0], [1, 0]]],
    contextPaths: [
      ...Array.from({length: 12001}, (_, i) => {
        const x = (i % 200) / 930, y = Math.floor(i / 200) / 930;
        return [[x, y], [x + 1 / 930, y]] as [number, number][];
      }),
      [[-1, 0.2], [2, 0.2]],
    ],
  }, 'line');
  assert.ok(basemap?.includes('M0 314L1000 314'));
  assert.equal((basemap?.match(/M/g) ?? []).length, 12002);
});
