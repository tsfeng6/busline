import { uploadCitySnapshot } from '../src/utils/cityUploadClient';
import { readCityUpload } from '../scripts/read-city-upload';
import { normalizeCityDataset } from '../src/utils/cityDataset';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { handleGateway, type Env } from '../cloudflare/city-gateway/worker';
import { collectCityDataset, parseRestLine } from '../scripts/collect-city-data';
import { CityUpdateJobClient } from '../src/utils/cityUpdateJobs';

class D1Test {
  db=new DatabaseSync(':memory:');
  constructor(){this.db.exec(readFileSync('cloudflare/city-gateway/schema.sql','utf8'));}
  prepare(sql:string){
    const wrap=(values:any[]=[])=>({bind:(...next:any[])=>wrap(next.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value)),
      first:async()=>this.db.prepare(sql).get(...values)||null,
      run:async()=>({results:/\b(SELECT|RETURNING)\b/i.test(sql)?this.db.prepare(sql).all(...values):[],...(!/\b(SELECT|RETURNING)\b/i.test(sql)?this.db.prepare(sql).run(...values):{})})});
    return wrap();
  }
  async batch(statements:any[]){this.db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());this.db.exec('COMMIT');return results;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
function setup(limit='10'){
  const database=new D1Test();let dispatches=0;
  const env:Env={JOBS:database as any,ALLOWED_ORIGINS:'https://busline.cc',GITHUB_REPO:'tsfeng6/busline',GITHUB_DISPATCH_TOKEN:'fake-dispatch',
    CALLBACK_SECRET:'test-callback-secret-at-least-32-characters',RATE_LIMIT_SALT:'test-ip-salt-at-least-16-characters',MAX_UPDATES_PER_DAY:limit,DAILY_UPDATE_LIMITS_ENABLED:'true'};
  const transport:typeof fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('raw.githubusercontent.com'))return new Response('{}',{status:404});
    if(url.endsWith('/dispatches')){dispatches++;const body=JSON.parse(String(init?.body));assert.deepEqual(Object.keys(body.inputs).sort(),['city','request_id']);assert.ok(!String(init?.body).includes('fake-dispatch'));return new Response(null,{status:204});}
    throw Error('Unexpected network destination');
  };
  const request=(city='北京市',ip='1.2.3.4')=>new Request('https://gateway.example/jobs',{method:'POST',headers:{Origin:'https://busline.cc','Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify({city})});
  return{database,env,transport,request,dispatches:()=>dispatches};
}

test('gateway uses a real SQL atomic city reservation so simultaneous anonymous requests join one job',async()=>{
  const x=setup();
  const responses=await Promise.all([handleGateway(x.request(),x.env,x.transport),handleGateway(x.request(),x.env,x.transport)]);
  const jobs=await Promise.all(responses.map(response=>response.json() as any));
  assert.equal(x.dispatches(),1);assert.equal(jobs[0].id,jobs[1].id);
  assert.ok(responses.every(response=>response.status===202));
});

test('gateway enforces origins, body limits and a global daily budget before dispatch',async()=>{
  const x=setup('1');
  const forbidden=new Request('https://gateway.example/jobs',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});
  assert.equal((await handleGateway(forbidden,x.env,x.transport)).status,403);
  const large=new Request('https://gateway.example/jobs',{method:'POST',headers:{Origin:'https://busline.cc'},body:'x'.repeat(1025)});
  assert.equal((await handleGateway(large,x.env,x.transport)).status,413);
  const results=await Promise.all([handleGateway(x.request('北京市'),x.env,x.transport),handleGateway(x.request('上海市','2.3.4.5'),x.env,x.transport)]);
  assert.deepEqual(results.map(item=>item.status).sort(),[202,429]);assert.equal(x.dispatches(),1);
});

test('signed Actions callbacks update progress; unsigned callbacks and terminal-state regressions are rejected',async()=>{
  const x=setup();const job:any=await(await handleGateway(x.request(),x.env,x.transport)).json();
  const callback=(state:string,secret=x.env.CALLBACK_SECRET)=>{
    const body=JSON.stringify({id:job.id,city:'北京市',state,message:'测试状态',at:Date.now()});
    return new Request('https://gateway.example/jobs/callback',{method:'POST',headers:{'x-city-signature':createHmac('sha256',secret).update(body).digest('hex')},body});
  };
  assert.equal((await handleGateway(callback('running','wrong'),x.env,x.transport)).status,401);
  assert.equal((await handleGateway(callback('running'),x.env,x.transport)).status,200);
  assert.equal((await handleGateway(callback('completed'),x.env,x.transport)).status,200);
  assert.equal((await handleGateway(callback('running'),x.env,x.transport)).status,409);
  const status:any=await(await handleGateway(new Request(`https://gateway.example/jobs/${job.id}`,{headers:{Origin:'https://busline.cc'}}),x.env,x.transport)).json();
  assert.equal(status.state,'completed');
});

test('gateway returns ready for fresh metadata and streams large JSON without treating it as job input',async()=>{
  const x=setup();
  const transport:typeof fetch=async(input)=>{
    if(String(input).endsWith('meta.json'))return Response.json({city:'北京市',capturedAt:new Date().toISOString(),retrievalComplete:true,filtered:false});
    return new Response('x'.repeat(2*1024*1024));
  };
  const ready:any=await(await handleGateway(x.request(),x.env,transport)).json();assert.equal(ready.state,'ready');assert.equal(x.dispatches(),0);
  const response=await handleGateway(new Request('https://gateway.example/api/city-data/北京市',{headers:{Origin:'https://busline.cc'}}),x.env,transport);
  assert.equal(response.status,200);assert.equal((await response.text()).length,2*1024*1024);
});

const poi={id:'p',name:'测试站',address:'6路',location:'116,39'};
const route=(id:string,name:string)=>({id,name,polyline:'116,39;116.01,39.01',start_stop:'辛庄子',end_stop:'京西公交',start_time:'0820',end_time:'1700',busstops:[{id:'s',name:'测试站',location:'116,39'}]});
function apiMock(lineFailure=false,repeatPoi=false){
  const counts={poi:0,line:0};
  const fetcher:typeof fetch=async(input)=>{
    const url=new URL(String(input));
    if(url.pathname.includes('district'))return Response.json({status:'1',districts:[{name:'张家口市',level:'city',adcode:'130700'}]});
    if(url.pathname.includes('/place/')){counts.poi++;return Response.json({status:'1',count:repeatPoi?'100':'1',pois:[poi]});}
    counts.line++;
    if(lineFailure)return Response.json({status:'0',infocode:'10003'});
    return Response.json({status:'1',count:'3',buslines:[route('a','6路(甲--乙)'),route('b','下花园6路(辛庄子--京西公交)'),route('c','下花园6路(京西公交--辛庄子)')]});
  };
  return{fetcher,counts};
}
test('Actions collection keeps all returned county lines and schedules instead of prefix-filtering 6路',async()=>{
  const api=apiMock();const result=await collectCityDataset('张家口','fake-key',{fetcher:api.fetcher,wait:async()=>{}});
  assert.equal(result.dataset.lines.length,3);assert.equal(result.dataset.retrievalComplete,true);
  assert.ok(result.dataset.lines.some(line=>line.name.startsWith('下花园6')));
  assert.ok(result.dataset.lines.every(line=>line.sourceQueries?.includes('6路')));
  assert.equal(result.dataset.lines[0].stime,'08:20');assert.equal(result.dataset.lines[0].etime,'17:00');
  assert.deepEqual(api.counts,{poi:1,line:1});
});
test('collection stops repeated POI pages and quota failure never becomes a successful empty snapshot',async()=>{
  const repeated=apiMock(false,true);
  const result=await collectCityDataset('张家口市','fake-key',{fetcher:repeated.fetcher,wait:async()=>{},searchPages:10});
  assert.equal(result.dataset.retrievalComplete,false);assert.equal(repeated.counts.poi,2);
  const limited=apiMock(true);
  await assert.rejects(()=>collectCityDataset('张家口市','fake-key',{fetcher:limited.fetcher,wait:async()=>{}}),/10003/);
  assert.equal(limited.counts.line,1);
  assert.equal(parseRestLine({...route('a','6路'),polyline:'bad'},'张家口市','6路'),null);
});

test('website job client submits only city names and tracks queued/running/completed states',async()=>{
  const id=crypto.randomUUID(),calls:any[]=[];let step=0;
  const client=new CityUpdateJobClient('https://gateway.example',async(input,init)=>{
    calls.push({url:String(input),body:init?.body});
    return Response.json({id,city:'北京市',state:init?.method==='POST'?'queued':step++===0?'running':'completed',message:'状态'});
  });
  const job=await client.start('北京');
  assert.deepEqual(JSON.parse(String(calls[0].body)),{city:'北京'});
  const states:string[]=[];
  const result=await client.watch(job,item=>states.push(item.state),new AbortController().signal,1,1000);
  assert.equal(result.state,'completed');assert.deepEqual(states,['queued','running','completed']);
});


test('default browser transport preserves the global fetch receiver required by Safari', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function (this: unknown) {
    assert.equal(this, globalThis);
    return Response.json({ city: '北京', state: 'ready', message: 'ready' });
  } as typeof fetch;
  try {
    const client = new CityUpdateJobClient('https://gateway.example');
    assert.equal((await client.start('北京')).state, 'ready');
  } finally { globalThis.fetch = original; }
});

test('partial collection records the provider interruption without leaking credentials', async () => {
  let lines=0;
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.includes('district'))return Response.json({status:'1',districts:[{name:'张家口市',level:'city',adcode:'130700'}]});
    if(url.pathname.includes('/place/'))return Response.json({status:'1',count:'1',pois:[{...poi,address:'6路;7路'}]});
    if(++lines===1)return Response.json({status:'1',count:'1',buslines:[route('a','6路(甲--乙)')]});
    return Response.json({status:'0',infocode:'10003',info:'sensitive-provider-message'});
  };
  const result=await collectCityDataset('张家口市','private-key',{fetcher,wait:async()=>{}});
  assert.equal(result.dataset.retrievalComplete,false);
  assert.equal(result.report.interruptions.length,1);
  assert.match(result.report.interruptions[0].message,/10003/);
  assert.ok(!JSON.stringify(result.report).includes('private-key'));
  assert.ok(!JSON.stringify(result.report).includes('sensitive-provider-message'));
});


test('temporarily disabling daily limits bypasses exhausted global and source budgets but still merges city jobs', async () => {
  const x=setup('1');
  await handleGateway(x.request('北京市'),x.env,x.transport);
  x.env.DAILY_UPDATE_LIMITS_ENABLED='false';
  for(const city of ['上海市','天津市','重庆市','保定市']) {
    assert.equal((await handleGateway(x.request(city),x.env,x.transport)).status,202);
  }
  const before=x.dispatches();
  await handleGateway(x.request('北京市'),x.env,x.transport);
  assert.equal(x.dispatches(),before);
  x.env.DAILY_UPDATE_LIMITS_ENABLED='true';
  assert.equal((await handleGateway(x.request('石家庄市'),x.env,x.transport)).status,429);
});

test('saturated city POI searches split spatially, exceed 200 stations, and exclude neighboring city POIs', async () => {
  const polygons=new Map<string,number>();let broadCalls=0;
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.includes('district'))return Response.json({status:'1',districts:[{name:'张家口市',level:'city',adcode:'130700',polyline:'116,39;116.1,39;116.1,39.1;116,39.1;116,39'}]});
    if(url.pathname==='/v3/place/text'){
      broadCalls++;
      return Response.json({status:'1',count:'9999',pois:Array.from({length:25},(_,i)=>({...poi,id:'p'+i,name:'站'+i,adcode:'130701'}))});
    }
    if(url.pathname==='/v3/place/polygon'){
      const polygon=url.searchParams.get('polygon')!;
      if(polygon==='116.000000,39.100000|116.100000,39.000000')return Response.json({status:'1',count:'9999',pois:[poi]});
      if(!polygons.has(polygon))polygons.set(polygon,polygons.size);
      const group=polygons.get(polygon)!,page=Number(url.searchParams.get('page'));
      const records=Array.from({length:61},(_,i)=>({...poi,id:'p'+(group*60+i),name:'站'+(group*60+i),adcode:i===60?'110101':'130701'}));
      return Response.json({status:'1',count:'61',pois:records.slice((page-1)*25,page*25)});
    }
    return Response.json({status:'1',count:'1',buslines:[route('a','6路(甲--乙)')]});
  };
  const result=await collectCityDataset('张家口市','private-key',{fetcher,wait:async()=>{}});
  assert.equal(broadCalls,1);assert.equal(polygons.size,4);
  assert.equal(result.dataset.retrievalComplete,true);
  assert.ok(result.dataset.stops.length>=240);
  assert.equal(result.report.discoveryComplete,true);
  assert.equal(result.report.counts.poi,14);
});

test('partial refresh reuses recent source-query paths and does not let a quota error erase them', async () => {
  const first=apiMock();
  const seed=(await collectCityDataset('张家口市','key',{fetcher:first.fetcher,wait:async()=>{}})).dataset;
  seed.retrievalComplete=false;
  let calls=0;
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.includes('district'))return Response.json({status:'1',districts:[{name:'张家口市',level:'city',adcode:'130700'}]});
    if(url.pathname.includes('/place/'))return Response.json({status:'1',count:'1',pois:[{...poi,address:'6路;7路'}]});
    calls++;assert.equal(url.searchParams.get('keywords'),'7路');
    return Response.json({status:'0',infocode:'10044'});
  };
  const result=await collectCityDataset('张家口市','key',{fetcher,seed,wait:async()=>{}});
  assert.equal(calls,1);assert.equal(result.dataset.lines.length,3);
  assert.equal(result.dataset.retrievalComplete,false);
  assert.match(result.report.interruptions[0].message,/10044/);
});


test('browser JSON uploads in authenticated chunks and Actions reads the same data without AMap calls', async () => {
  const x=setup();let uploaded=false,externalCalls=0;
  const external:typeof fetch=async(input,init)=>{
    externalCalls++;assert.ok(String(input).endsWith('/dispatches'));
    const body=JSON.parse(String(init?.body));uploaded=body.inputs.uploaded===true;
    return new Response(null,{status:204});
  };
  const origin='https://gateway.example';
  const transport:typeof fetch=async(input,init)=>{
    const headers=new Headers(init?.headers);headers.set('Origin','https://busline.cc');
    return handleGateway(new Request(String(input),{...init,headers}),x.env,external);
  };
  const data=normalizeCityDataset({schemaVersion:1,city:'北京市',scope:'city',coverage:'observed',filtered:false,retrievalComplete:true,capturedAt:new Date().toISOString(),
    stops:Array.from({length:1000},(_,i)=>({id:'s'+i,name:'中文站点'+i+'中'.repeat(100),address:'6路',location:{lng:116+i*.00001,lat:39}})),
    lines:[{id:'l',name:'6路(甲--乙)',city:'北京市',sourceQueries:['6路'],path:Array.from({length:40000},(_,i)=>[116+Math.sin(i*12.9898)*.01,39+Math.cos(i*78.233)*.01]),via_stops:[]}]});
  assert.equal(externalCalls,0);
  const progress:number[]=[];const job=await uploadCitySnapshot(origin,data,n=>progress.push(n),transport);
  assert.equal(job.state,'queued');assert.equal(uploaded,true);assert.equal(externalCalls,1);
  assert.ok(progress.length>1);assert.equal(progress.at(-1),100);
  const restored=await readCityUpload(new URL(origin),job.id!,'北京市',x.env.CALLBACK_SECRET,transport);
  assert.deepEqual(restored,data);
  await assert.rejects(()=>readCityUpload(new URL(origin),job.id!,'上海市',x.env.CALLBACK_SECRET,transport),/清单无效/);
  const denied=await handleGateway(new Request(`${origin}/uploads/${job.id}`,{headers:{Origin:'https://busline.cc'}}),x.env,external);
  assert.equal(denied.status,401);
  const callback=JSON.stringify({id:job.id,city:'北京市',state:'completed',message:'saved',at:Date.now()});
  assert.equal((await handleGateway(new Request(origin+'/jobs/callback',{method:'POST',body:callback,headers:{'x-city-signature':createHmac('sha256',x.env.CALLBACK_SECRET).update(callback).digest('hex')}}),x.env,external)).status,200);
  assert.equal(x.database.db.prepare('SELECT COUNT(*) AS count FROM city_upload_parts').get()!.count,0);
});

test('local search contains no automatic update or upload calls before the user confirms', () => {
  const source=readFileSync('src/App.tsx','utf8');
  const search=source.slice(source.indexOf('  const handleSearch ='),source.indexOf('  const watchCityActionJob ='));
  assert.ok(!search.includes('cityUpdateJobs.start('));
  assert.ok(!search.includes('saveSharedCity('));
  assert.ok(!search.includes('acquireCityRefresh('));
  assert.ok(search.includes('setPendingCityUpload(dataset)'));
  assert.ok(search.includes('new searchServices.PlaceSearch('));
  assert.ok(search.includes('await getCitySearchServices(customApiKey, customApiSecurityCode)'));
});


test('upload manifest accepts exactly 1GiB and rejects larger files without allocating the payload', async () => {
  const x=setup();
  const request=(bytes:number)=>new Request('https://gateway.example/uploads',{method:'POST',headers:{Origin:'https://busline.cc'},body:JSON.stringify({city:'北京市',bytes,parts:Math.ceil(bytes/(256*1024)),sha256:'a'.repeat(64),format:'city-records-gzip-v1'})});
  assert.equal((await handleGateway(request(1024**3+1),x.env,x.transport)).status,400);
  const accepted=await handleGateway(request(1024**3),x.env,x.transport);
  assert.equal(accepted.status,200);
  assert.equal(x.dispatches(),0);
});

test('gateway checks only active metadata and streams immutable BVPK1 bytes for direct clients', async () => {
  const x = setup();
  const calls: string[] = [];
  const pack = Uint8Array.from([66, 86, 80, 75, 49, 0, 255]);
  const part = 'a'.repeat(64) + '.bvpk';
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/meta.json')) return new Response(null, { status: 404 });
    if (url.endsWith('/bvpk/' + part)) return new Response(pack);
    return x.transport(input, init);
  };
  const job = await handleGateway(x.request(), x.env, transport);
  assert.equal(job.status, 202);
  assert.ok(calls.every(url => !url.includes('/history')));
  const response = await handleGateway(
    new Request('https://gateway.example/api/city-data/北京市/bvpk/' + part, { headers: { Origin: 'https://busline.cc' } }),
    x.env, transport,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
  assert.match(response.headers.get('Cache-Control')!, /immutable/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pack);
});
