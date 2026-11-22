import { citySearchApiStatus } from '../src/utils/citySearchApi';
import {CITY_DETAIL_ZOOM} from '../src/utils/cityOverview';
import { lazyStopMarker, clearStopMarkerGroup } from '../src/utils/lazyStopMarker';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { previewableCityDataset, normalizeCityDataset } from '../src/utils/cityDataset';
import { resolveSearchCity } from '../src/utils/searchCity';
import { lineBaseIdentity, matchesReturnedLine } from '../src/utils/lineIdentity';

test('fresh shared data draws directly and a remote cache miss starts browser search without an Actions collection', async () => {
  const snapshot = normalizeCityDataset({ schemaVersion: 1, city: '北京市', scope: 'city', coverage: 'observed',
    capturedAt: new Date().toISOString(), retrievalComplete: true, filtered: false,
    stops: [{ id: 's', name: '站点', address: '6路', location: { lng: 116, lat: 39 } }],
    lines: [{ id: 'l', name: '6路(甲--乙)', city: '北京市', sourceQueries: ['6路'],
      path: [[116,39],[116.01,39.01]], via_stops: [] }],
  });
  const source = fs.readFileSync('src/App.tsx', 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleSearch') declaration = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(declaration);
  const code = ts.transpile(`const ${declaration.getText(ast)};`, { target: ts.ScriptTarget.ES2022 });
  const ref = (current: any) => ({current});
  const errors: any[] = [];
  let rendered: string[] = [], apiRequests = 0;
  class Bounds {
    constructor(public sw = [115,38], public ne = [117,40]) {}
    getSouthWest() { return { lng: this.sw[0], lat: this.sw[1] }; }
    getNorthEast() { return { lng: this.ne[0], lat: this.ne[1] }; }
    getCenter() { return { lng: 116, lat: 39 }; }
    contains() { return true; }
  }
  const map = { getZoom: () => 14, getCenter: () => ({lng:116,lat:39}), getBounds: () => new Bounds() };
  const scope: any = {
    console: {error: (...args: any[]) => errors.push(args),warn: (...args: any[]) => errors.push(args)}, performance, setTimeout, clearTimeout,
    window: {AMap:{Bounds, Geocoder:class{getAddress(_: any, cb: any){cb('complete',{regeocode:{addressComponent:{city:[],province:'北京市'}}});}},
      PlaceSearch:class{constructor(){apiRequests++;throw Error('Unexpected POI request');}},
      LineSearch:class{constructor(){apiRequests++;throw Error('Unexpected line request');}},
      StationSearch:class{constructor(){apiRequests++;throw Error('Unexpected station request');}},
      CircleMarker:class{on(){}},
    }},
    manualResultCityRef:ref(''),pendingCityUploadRef:ref(null),pendingCityUpload:null,cityUploadBusy:false,mapRef:ref(map), roadLookupVersionRef:ref(0), sharedMapDataRef:ref(false), isClearedRef:ref(false),searchVersionRef:ref(0),
    referenceBoxRef:ref(null),filterTerminalOnlyRef:ref(false),lastSearchCityRef:ref(''),fetchedLinesCache:ref(new Map()),queriedLineNamesRef:ref(new Set()),
    enableLineCacheRef:ref(false),cachedLinesVersionRef:ref(0),isMinigameActiveRef:ref(false),
    lazyStopMarker,clearStopMarkerGroup,markerGroupRef:ref({getOverlays(){return []},clearOverlays(){}}),allMapStopsRef:ref(new Map()),stopCountCacheRef:ref(new Map()),
    activeRawMarkersRef:ref([]),roadStopMarkersRef:ref([]),roadStopsDataRef:ref(new Map()),
    filterIntervalBusRef:ref(false),filterAirportBusRef:ref(false),blockedKeywordsRef:ref([]),searchFilterVersionRef:ref(1),
    getCitySearchServices:async(key:string,code:string)=>{assert.equal(key,'a'.repeat(32));assert.equal(code,'b'.repeat(32));return scope.window.AMap;},
    citySearchApiStatus,useCustomApiKey:false,customApiKey:'a'.repeat(32),customApiSecurityCode:'b'.repeat(32),initialAmapConfig:{isCustom:true,key:'a'.repeat(32),securityCode:'b'.repeat(32)},focusCustomApiRef:ref(false),
    CITY_DETAIL_ZOOM,enableCityWideSearch:true,sharedCityDataEnabled:true,actionsCityUpdatesEnabled:false,loadSharedCity:async()=>snapshot,
    citySnapshotFresh:()=>true,citySnapshotPreviewable:previewableCityDataset,resolveSearchCity,normalizeCityDataset,matchesReturnedLine,lineBaseIdentity,
    cityDataCache:{remember(){}},discoverCityStops:async()=>{apiRequests++;throw Error('Unexpected POI request');},
    updateTerminalNamesCache(){},syncStopMarkersToMap(){},getStopColor:()=> '#52796F',isLineNameBlockedRef:()=>false,
    aggregateAndVisualize:async(names:string[])=>{rendered=names;},
    fetchAndDrawLines:()=>{throw Error('Shared city must bypass live line discovery');},
    getBoxForStops:()=>({minLng:115,maxLng:117,minLat:38,maxLat:40}),clipPathToBox:(path:any)=>[path],
    getLatLng:(p:any)=>[p.lng,p.lat],drawReferenceArea(){},
    clearPriorityCoverage(){},checkAmapQuotaError(){},isAdminVerified:false,adminPasswordUsed:'',
  };
  const proxy = new Proxy(scope, {
    has(target,key) { return key in target || (typeof key==='string' && key.startsWith('set')); },
    get(target,key) { return key in target ? target[key] : typeof key==='string'&&key.startsWith('set') ? ()=>{} : undefined; },
  });
  const run = Function('scope',`with(scope){${code};return handleSearch;}`)(proxy);
  await run();
  assert.deepEqual(errors,[]);
  assert.deepEqual(rendered,['6路(甲--乙)']);
  assert.equal(apiRequests,0);
  assert.equal(scope.sharedMapDataRef.current,true);
  rendered=[];
  const version=scope.searchVersionRef.current;
  scope.pendingCityUpload=snapshot;
  scope.pendingCityUploadRef.current=snapshot;
  await run(false,snapshot);
  assert.deepEqual(rendered,[]);
  assert.equal(scope.searchVersionRef.current,version);
  scope.pendingCityUpload=null;
  scope.pendingCityUploadRef.current=null;
  scope.manualResultCityRef.current='北京';
  await run(false,snapshot);
  assert.deepEqual(rendered,[]);
  assert.equal(scope.searchVersionRef.current,version);
  scope.manualResultCityRef.current='';
  scope.actionsCityUpdatesEnabled=true;
  scope.citySnapshotFresh=()=>false;
  scope.loadSharedCity=async()=>({...snapshot,retrievalComplete:false});
  await run();
  assert.deepEqual(errors,[]);
  assert.deepEqual(rendered,['6路(甲--乙)']);
  assert.equal(apiRequests,0);
  rendered=[];
  scope.useCustomApiKey=true;
  scope.loadSharedCity=async()=>null;
  scope.actionsCityUpdatesEnabled=true;
  scope.cityJobWatchRef=ref(null);
  let started=0,watched=0;
  scope.cityUpdateJobs={start:async(city:string)=>{started++;return {id:crypto.randomUUID(),city,state:'queued',message:'等待更新'};}};
  scope.watchCityActionJob=()=>{watched++;};
  await run();
  assert.equal(started,0);assert.equal(watched,0);assert.equal(apiRequests,1);assert.deepEqual(rendered,[]);
  assert.ok(errors.some(args=>String(args).includes('Unexpected POI request')));
  // Missing or edited-but-not-loaded visitor credentials must block all live POI/line queries.
  for(const mode of ['missing','incomplete','expired']) {
    errors.length=0;apiRequests=0;
    scope.useCustomApiKey=mode==='incomplete';
    scope.customApiSecurityCode=mode==='incomplete'?'':'b'.repeat(32);
    scope.loadSharedCity=async()=>mode==='expired'?{...snapshot,capturedAt:new Date(Date.now()-90*86400000).toISOString()}:null;
    scope.initialAmapConfig={isCustom:false,key:'public',securityCode:'public'};
    scope.manualResultCityRef.current='';
    await run();
    assert.equal(apiRequests,0);assert.deepEqual(errors,[]);assert.equal(scope.focusCustomApiRef.current,true);
  }
  // A completed collection offers upload before later Safari rendering/precise-platform work can fail.
  scope.useCustomApiKey=true;
  scope.customApiSecurityCode='b'.repeat(32);
  scope.loadSharedCity=async()=>null;
  scope.initialAmapConfig={isCustom:true,key:scope.customApiKey,securityCode:scope.customApiSecurityCode};
  scope.manualResultCityRef.current='';
  map.getZoom=()=>12;
  scope.discoverCityStops=async()=>({pois:snapshot.stops,complete:true});
  scope.setPendingCityUpload=(data:any)=>{scope.pendingCityUploadRef.current=data;scope.pendingCityUpload=data;};
  scope.fetchAndDrawLines=async(_names:any,_map:any,_amap:any,_city:any,_cancel:any,_force:any,onCollected:any)=>{
    for(const line of snapshot.lines)scope.fetchedLinesCache.current.set(line.name,{...line,city:'北京'});
    onCollected(true);
    throw Error('simulated Safari rendering failure');
  };
  errors.length=0;
  await run();
  assert.ok(scope.pendingCityUpload);
  assert.equal(scope.pendingCityUpload.city,'北京市');
  assert.equal(scope.pendingCityUpload.lines.length,1);
  assert.ok(errors.some(args=>String(args).includes('simulated Safari rendering failure')));

});

test('map browsing reads only city summaries and discards results from the previous city', async () => {
  const source = fs.readFileSync('src/App.tsx', 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let arrow: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.arguments[0]?.getText(ast).includes('setPublishedCitySummary(city')) arrow = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(arrow);
  const code = ts.transpile(`const effect = ${arrow.getText(ast)};`, { target: ts.ScriptTarget.ES2022 });
  for (const scenario of ['published', 'missing', 'zoomed-out', 'cancelled'] as const) {
    const summaries: unknown[] = [], notices: unknown[] = [], jobs: Array<() => void> = [];
    const city = { city: '北京市', lineDirections: 1000 };
    let complete: (value: unknown) => void = () => {};
    const scope = {
      CITY_DETAIL_ZOOM, sharedCityDataEnabled: true, mapInstance: {}, showMinigameModal: false, onboardingStep: 0,
      showSettings: false, zoomLevel: scenario === 'zoomed-out' ? 8 : 15, currentCity: '北京市',
      loadPublishedCities: () => new Promise(resolve => { complete = resolve; }),
      loadSharedCity: () => { throw Error('Viewport browsing must not load a full snapshot'); },
      setPublishedCitySummary: (value: unknown) => summaries.push(value), setCityDataNotice: (value: unknown) => notices.push(value),
      setTimeout: (job: () => void) => { jobs.push(job); return 1; }, clearTimeout() {},
    };
    const cleanup = Function('scope', `with(scope){${code};return effect();}`)(scope);
    jobs.forEach(job => job());
    if (scenario === 'cancelled') cleanup();
    complete(scenario === 'missing' ? [] : [city]);
    await Promise.resolve();
    if (scenario === 'published') {
      assert.deepEqual(summaries, [city]);
      assert.deepEqual(notices, [null]);
    } else if (scenario === 'missing') {
      assert.deepEqual(summaries, [null]);
      assert.deepEqual(notices, [{ city: '北京市', kind: 'missing' }]);
    } else {
      assert.deepEqual(summaries, []);
      assert.deepEqual(notices, scenario === 'zoomed-out' ? [null] : []);
    }
    cleanup?.();
  }
});

test('city collection requires both visitor credentials independently of the public map',()=>{
 const key='a'.repeat(32),securityCode='b'.repeat(32);
 assert.equal(citySearchApiStatus(false,key,securityCode),'missing');
 assert.equal(citySearchApiStatus(true,key,''),'missing');
 assert.equal(citySearchApiStatus(true,'invalid',securityCode),'missing');
 assert.equal(citySearchApiStatus(true,' '+key+' ',securityCode),'ready');
});

test('line collection publishes its result before rendering, and cancelled searches never publish',async()=>{
 const ast=ts.createSourceFile('App.tsx',fs.readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration:ts.VariableDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='fetchAndDrawLines')declaration=node;ts.forEachChild(node,visit);};
 visit(ast);assert.ok(declaration);
 const code=ts.transpile(`const ${declaration.getText(ast)};`,{target:ts.ScriptTarget.ES2022});
 const ref=(current:any)=>({current});const events:string[]=[];
 const scope={searchVersionRef:ref(1),isClearedRef:ref(false),isMinigameActiveRef:ref(false),fetchedLinesCache:ref(new Map()),setTimeout,
  aggregateAndVisualize:async()=>{events.push('render');throw Error('render failure');}};
 const run=Function('scope',`with(scope){${code};return fetchAndDrawLines;}`)(scope);
 await assert.rejects(run([],{}, {}, '北京市',()=>false,false,()=>events.push('collected')),/render failure/);
 assert.deepEqual(events,['collected','render']);
 events.length=0;scope.isClearedRef.current=true;
 await run([],{}, {}, '北京市',()=>false,false,()=>events.push('collected'));
 assert.deepEqual(events,[]);
});

test('private collection SDK messages are isolated from the public map and authenticate origin, source and channel',async()=>{
 const raw=fs.readFileSync('src/utils/citySearchRealm.ts','utf8').replace('import.meta.env.BASE_URL',"'/'");
 const code=ts.transpile(raw,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
 const handlers=new Set<any>(),frames:any[]=[],sent:any[]=[];
 const publicSDK={key:'public-key'};
 const window:any={location:{origin:'https://busline.cc'},AMap:publicSDK,addEventListener:(_:any,fn:any)=>handlers.add(fn),removeEventListener:(_:any,fn:any)=>handlers.delete(fn)};
 const document:any={createElement:()=>{const events:any={};return {events,contentWindow:{postMessage:(data:any,origin:string)=>sent.push({data,origin})},setAttribute(){},addEventListener:(name:string,fn:any)=>events[name]=fn,remove(){}};},body:{appendChild:(frame:any)=>frames.push(frame)}};
 const exports:any={};Function('exports','window','document','crypto','setTimeout','clearTimeout',code)(exports,window,document,crypto,setTimeout,clearTimeout);
 const key='a'.repeat(32),security='b'.repeat(32),promise=exports.getCitySearchServices(key,security);
 const frame=frames[0];assert.equal(frame.src,'/amap-search-frame.html');assert.ok(!frame.src.includes(key));frame.events.load();
 const init=sent[0].data;assert.equal(init.key,key);assert.equal(init.securityCode,security);
 const emit=(data:any,origin=window.location.origin,source=frame.contentWindow)=>{for(const handler of handlers)handler({data,origin,source});};
 let ready=false;void promise.then(()=>ready=true);
 emit({type:'ready',channel:init.channel},'https://foreign.example');await Promise.resolve();assert.equal(ready,false);
 emit({type:'ready',channel:init.channel},window.location.origin,{});await Promise.resolve();assert.equal(ready,false);
 emit({type:'ready',channel:init.channel});const services=await promise;
 const query=new services.PlaceSearch({city:'北京市'});query.setPageIndex(2);
 let result:any;query.search('',(status:any,value:any)=>{result={status,value};});
 const request=sent.at(-1).data;assert.equal(request.options.pageIndex,2);assert.equal(request.service,'PlaceSearch');
 emit({type:'result',channel:'wrong',id:request.id,status:'complete',result:{bad:true}});assert.equal(result,undefined);
 emit({type:'result',channel:init.channel,id:request.id,status:'complete',result:{poiList:{pois:[]}}});
 assert.deepEqual(result,{status:'complete',value:{poiList:{pois:[]}}});
 assert.equal(window.AMap,publicSDK);assert.equal(window.AMap.key,'public-key');
 assert.equal(window._AMapSecurityConfig,undefined);
});

test('isolated AMap frame preserves SDK coordinates without exposing them to another origin',async()=>{
 const {runInNewContext}=await import('node:vm');
 const html=fs.readFileSync('public/amap-search-frame.html','utf8'),script=html.match(/<script>([\s\S]*)<\/script>/)![1];
 let receive:any,loaded:any;const messages:any[]=[],parent={postMessage:(data:any,origin:any)=>messages.push({data,origin})};
 const sandbox:any={parent,location:{origin:'https://busline.cc'},addEventListener:(_:any,fn:any)=>receive=fn,
  document:{createElement:()=>({}),head:{appendChild:(script:any)=>loaded=script}},
  AMap:{LineSearch:class{search(_query:any,callback:any){callback('complete',{lineInfo:[{path:[{getLng:()=>116.123456789123,getLat:()=>39.987654321098}]}]});}}}};
 sandbox.window=sandbox;runInNewContext(script,sandbox);
 const init={type:'init',channel:'channel',key:'a'.repeat(32),securityCode:'b'.repeat(32)};
 receive({source:parent,origin:'https://foreign.example',data:init});assert.equal(loaded,undefined);
 receive({source:parent,origin:sandbox.location.origin,data:init});assert.ok(loaded.src.startsWith('https://webapi.amap.com/maps?'));loaded.onload();
 receive({source:parent,origin:sandbox.location.origin,data:{type:'query',channel:'channel',id:1,service:'LineSearch',method:'search',args:['6路']}});
 const result=messages.at(-1);assert.equal(result.origin,sandbox.location.origin);
 assert.equal(result.data.result.lineInfo[0].path[0].lng,116.123456789123);assert.equal(result.data.result.lineInfo[0].path[0].lat,39.987654321098);
});

test('terms require reaching the real scroll bottom and an explicit checkbox; consent is versioned locally',async()=>{
 const {reachedTermsEnd,canAcceptTerms,acceptTerms,hasAcceptedTerms,TERMS_ACCEPTANCE_KEY}=await import('../src/utils/onboardingConsent');
 assert.equal(reachedTermsEnd({scrollTop:0,scrollHeight:3000,clientHeight:320}),false);
 assert.equal(reachedTermsEnd({scrollTop:2678.5,scrollHeight:3000,clientHeight:320}),true);
 assert.equal(reachedTermsEnd({scrollTop:0,scrollHeight:0,clientHeight:0}),false);
 assert.equal(reachedTermsEnd({scrollTop:NaN,scrollHeight:3000,clientHeight:320}),false);
 assert.equal(reachedTermsEnd({scrollTop:0,scrollHeight:200,clientHeight:320}),true);
 assert.equal(canAcceptTerms(false,true),false);assert.equal(canAcceptTerms(true,false),false);assert.equal(canAcceptTerms(true,true),true);
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)};
 assert.equal(hasAcceptedTerms(storage),false);acceptTerms(storage);assert.equal(hasAcceptedTerms(storage),true);
 values.set(TERMS_ACCEPTANCE_KEY,JSON.stringify({version:'old',acceptedAt:new Date().toISOString()}));assert.equal(hasAcceptedTerms(storage),false);
 values.set(TERMS_ACCEPTANCE_KEY,'invalid');assert.equal(hasAcceptedTerms(storage),false);
 assert.doesNotThrow(()=>acceptTerms({setItem(){throw Error('storage unavailable');}}));
});

test('actual onboarding navigation cannot skip consent, allows declining API, and validates opted-in credentials',async()=>{
 const {canAcceptTerms}=await import('../src/utils/onboardingConsent');
 const source=fs.readFileSync('src/components/OnboardingGuide.tsx','utf8'),ast=ts.createSourceFile('OnboardingGuide.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration:ts.VariableDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleNext')declaration=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(declaration);
 const code=ts.transpile(`const ${declaration.getText(ast)};`,{target:ts.ScriptTarget.ES2022});
 const events:any[]=[],scope:any={step:1,readToEnd:false,agreed:false,useCustomApiKey:false,customApiKey:'',customApiSecurityCode:'',canAcceptTerms,citySearchApiStatus,
  onAcceptTerms:()=>events.push('accepted'),onFinishOnboarding:()=>events.push('finished'),setStep:(value:number)=>events.push(value),setApiError:(value:string)=>events.push(value)};
 const run=Function('scope',`with(scope){${code};return handleNext;}`)(scope);
 run();assert.deepEqual(events,[2]);events.length=0;
 scope.step=2;run();assert.deepEqual(events,[]);
 scope.agreed=true;run();assert.deepEqual(events,[]);
 scope.readToEnd=true;scope.agreed=false;run();assert.deepEqual(events,[]);
 scope.agreed=true;run();assert.deepEqual(events,['accepted',3]);events.length=0;
 scope.step=3;run();assert.deepEqual(events,[4]);events.length=0;
 scope.useCustomApiKey=true;run();assert.equal(events.length,1);assert.equal(typeof events[0],'string');events.length=0;
 scope.customApiKey='a'.repeat(32);scope.customApiSecurityCode='b'.repeat(32);run();assert.deepEqual(events,[4]);events.length=0;
 scope.step=4;run();assert.deepEqual(events,['finished']);
});

test('parent completion guard prevents marking onboarding complete before consent; terms file has all seven sections',()=>{
 const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration:ts.VariableDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleFinishOnboarding')declaration=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(declaration);
 const code=ts.transpile(`const ${declaration.getText(ast)};`,{target:ts.ScriptTarget.ES2022}),events:any[]=[];
 const scope={termsAcceptedRef:{current:false},APP_LAST_VERSION_KEY:'visited',APP_VERSION:'5.5',localStorage:{setItem:(key:string,value:string)=>events.push([key,value])},setOnboardingStep:(value:number)=>events.push(value)};
 const run=Function('scope',`with(scope){${code};return handleFinishOnboarding;}`)(scope);run();assert.deepEqual(events,[2]);events.length=0;
 scope.termsAcceptedRef.current=true;run();assert.deepEqual(events,[['visited','5.5'],0]);
 const terms=fs.readFileSync('src/content/busline-terms.md','utf8');assert.equal(terms.match(/^## /gm)?.length,7);assert.equal(terms.match(/^\d+\. /gm)?.length,24);
 assert.ok(terms.endsWith('最后更新日期：2026 年 11 月 17 日\n'));
});
