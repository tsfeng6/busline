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
    const wrap=(values:any[]=[])=>({bind:(...next:any[])=>wrap(next),
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
  await assert.rejects(()=>collectCityDataset('张家口市','fake-key',{fetcher:limited.fetcher,wait:async()=>{}}),/未取得有效线路/);
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
