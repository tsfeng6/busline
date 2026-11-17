import {CITY_DETAIL_ZOOM} from '../src/utils/cityOverview';
import { lazyStopMarker, clearStopMarkerGroup } from '../src/utils/lazyStopMarker';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { previewableCityDataset, normalizeCityDataset } from '../src/utils/cityDataset';
import { resolveSearchCity } from '../src/utils/searchCity';
import { matchesReturnedLine } from '../src/utils/lineIdentity';

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
    enableCityWideSearch:true,sharedCityDataEnabled:true,actionsCityUpdatesEnabled:false,loadSharedCity:async()=>snapshot,
    citySnapshotFresh:()=>true,citySnapshotPreviewable:previewableCityDataset,resolveSearchCity,normalizeCityDataset,matchesReturnedLine,
    updateTerminalNamesCache(){},syncStopMarkersToMap(){},getStopColor:()=> '#52796F',isLineNameBlockedRef:()=>false,
    aggregateAndVisualize:async(names:string[])=>{rendered=names;},
    fetchAndDrawLines:()=>{throw Error('Shared city must bypass live line discovery');},
    getBoxForStops:()=>({minLng:115,maxLng:117,minLat:38,maxLat:40}),clipPathToBox:(path:any)=>[path],
    getLatLng:(p:any)=>[p.lng,p.lat],drawReferenceArea(){},
    isAdminVerified:false,adminPasswordUsed:'',
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
  scope.loadSharedCity=async()=>null;
  scope.actionsCityUpdatesEnabled=true;
  scope.cityJobWatchRef=ref(null);
  scope.cityAutoChecksRef=ref(new Map());
  let started=0,watched=0;
  scope.cityUpdateJobs={start:async(city:string)=>{started++;return {id:crypto.randomUUID(),city,state:'queued',message:'等待更新'};}};
  scope.watchCityActionJob=()=>{watched++;};
  await run();
  assert.equal(started,0);assert.equal(watched,0);assert.equal(apiRequests,1);assert.deepEqual(rendered,[]);
  assert.ok(errors.some(args=>String(args).includes('Unexpected POI request')));
});

test('city auto-loading respects manual results and upload dialogs, and discards late network responses', async () => {
  const source=fs.readFileSync('src/App.tsx','utf8');
  const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let arrow: ts.Node | undefined;
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('cityAutoChecksRef.current.get(key)')) arrow=node.arguments[0];
    ts.forEachChild(node,visit);
  };
  visit(ast); assert.ok(arrow);
  const code=ts.transpile(`const effect = ${arrow.getText(ast)};`,{target:ts.ScriptTarget.ES2022});
  const data=normalizeCityDataset({schemaVersion:1,city:'北京市',scope:'city',coverage:'observed',capturedAt:new Date().toISOString(),retrievalComplete:true,filtered:false,
    stops:[{id:'s',name:'站点',address:'6路',location:{lng:116,lat:39}}],lines:[{id:'l',name:'6路(甲--乙)',city:'北京市',path:[[116,39],[116.1,39.1]],via_stops:[]}]});
  for(const scenario of ['ready','missing','expired','unavailable','zoomed-out','city-overview','cancelled','manual-result','submission-dialog','uploading','late-response','new-search','late-dialog']) {
    const notices:any[]=[], rendered:any[]=[], jobs:(()=>Promise<void>)[]=[];
    const snapshot=scenario==='expired'?{...data,capturedAt:new Date(Date.now()-90*86400000).toISOString()}:data;
    const scope:any={CITY_DETAIL_ZOOM,sharedCityDataEnabled:true,mapInstance:{},isSearching:false,showMinigameModal:false,onboardingStep:0,
      activeBusLine:null,cityUpdateJob:null,pendingCityUploadRef:{current:scenario==='submission-dialog'?snapshot:null},pendingCityUpload:scenario==='submission-dialog'?snapshot:null,cityUploadBusy:scenario==='uploading',manualResultCityRef:{current:scenario==='manual-result'?'北京':''},searchVersionRef:{current:1},zoomLevel:scenario==='zoomed-out'?8:scenario==='city-overview'?12:13,currentCity:'北京市',Date,
      sharedMapDataRef:{current:false},lastCityDataset:null,cityAutoChecksRef:{current:new Map()},isMinigameActiveRef:{current:false},
      citySnapshotPreviewable:previewableCityDataset,actionsCityUpdatesEnabled:false,inspectSharedCity:async()=>scenario==='missing'?{data:null,status:'missing'}:scenario==='unavailable'?{data:null,status:'unavailable'}:{data:snapshot,status:'ready'},
      citySnapshotFresh:(value:any)=>value.capturedAt===data.capturedAt,
      handleSearch:(...args:any[])=>rendered.push(args),setCityDataNotice:(notice:any)=>notices.push(notice),setLastCityDataset(){},handleClear(){},
      setTimeout:(job:()=>Promise<void>)=>{jobs.push(job);return 1;},clearTimeout(){},
    };
    let resolveRead:((value:any)=>void)|undefined;
    if(['late-response','new-search','late-dialog'].includes(scenario))scope.inspectSharedCity=()=>new Promise(resolve=>{resolveRead=resolve;});
    const cleanup=Function('scope',`with(scope){${code};return effect();}`)(scope);
    if(scenario==='cancelled') cleanup?.();
    for(const job of jobs) {
      const waiting=job();
      if(resolveRead){
        if(scenario==='late-dialog')scope.pendingCityUploadRef.current=snapshot;
        else scope.searchVersionRef.current++;
        if(scenario==='late-response')scope.manualResultCityRef.current='北京';
        resolveRead({data:snapshot,status:'ready'});
      }
      await waiting;
    }
    if(scenario==='ready') {assert.equal(rendered.length,1); assert.equal(rendered[0][0],false);assert.equal(rendered[0][1],data);}
    else {assert.equal(rendered.length,0);if(['missing','expired','unavailable'].includes(scenario))assert.equal(notices[0].kind,scenario);else assert.equal(notices.length,0);}
    cleanup?.();
  }
});
