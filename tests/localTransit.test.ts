import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {regularGameRoute,eligibleGameLines,clipRouteToRadius,distanceMeters,nearbyLines,gpsToMap,claimDailyLocation,savedCountySeats,provinceForCity,radiusRing} from '../src/utils/localTransit';
import {COUNTY_GAME_RADIUS_METERS,createOfflineQuestion,gameStage,nearbyStationChoices} from '../src/utils/offlineGame';
import {getContestTotalTime, getGameTimeLimit, recordGameAnswer} from '../src/utils/gameTimer';
import {CityDataCache} from '../src/utils/cityDataCache';
import {expandSavedStationCoverage} from '../src/utils/stationCoverage';
import {contestRules, contestPrompts} from '../src/utils/contestRules';
import {drawContestQuestion} from '../src/utils/contestDrawing';
import {createSimulationQuestion} from '../src/utils/simulationQuestion';
import {normalizeCityDataset} from '../src/utils/cityDataset';
const center:[number,number]=[116,39];
const data=()=>normalizeCityDataset({schemaVersion:1,city:'北京市',scope:'city',coverage:'observed',filtered:false,retrievalComplete:true,capturedAt:new Date().toISOString(),
 stops:[{id:'s',name:'海淀区政府',address:'1路;X107路',location:{lng:116,lat:39}},{id:'t',name:'东站',address:'1路',location:{lng:116.01,lat:39}}],
 lines:[{id:'1',name:'1路(甲--乙)',city:'北京市',path:[[115.95,39],[116.05,39]],via_stops:[{name:'海淀区政府',location:{lng:116,lat:39}},{name:'东站',location:{lng:116.01,lat:39}}]},
 {id:'2',name:'X107路(甲--乙)',city:'北京市',path:[[116,38.95],[116,39.05]],via_stops:[{name:'海淀区政府',location:{lng:116,lat:39}}]},
 {id:'3',name:'快速直达专线187路',city:'北京市',path:[[115.95,38.95],[116.05,39.05]],via_stops:[{name:'海淀区政府',location:{lng:116,lat:39}}]}]});
test('game routes keep ordinary numeric services in both ladders',()=>{
 for(const name of ['1路','368路','X107路','兴33路','黎城5路','368快路','围场8路','300路内环','M191路(甲--乙)'])assert.equal(regularGameRoute(name),true,name);
 for(const name of ['快速直达专线187路','节假日5路','北京密码','机场巴士','机场5路','地铁1号线','市郊铁路S2线','商务班车1路','旅游专线2路'])assert.equal(regularGameRoute(name),false,name);
 assert.equal(eligibleGameLines(data().lines,'easy').length,2);assert.equal(eligibleGameLines(data().lines,'hell').length,2);
 const special={...data(),lines:[data().lines[2]]};assert.throws(()=>createOfflineQuestion('line','easy',special,[],1),/常规线路/);
 assert.throws(()=>createOfflineQuestion('line','hell',special,[],1),/常规线路/);
});
test('nearby 500m queries include crossing geometry without nearby stops and deduplicate route directions',()=>{
 const snapshot=data();
 snapshot.lines.push({...snapshot.lines[0],id:'reverse',name:'1路(乙--甲)',path:[...snapshot.lines[0].path].reverse()});
 snapshot.lines.push({...snapshot.lines[0],id:'far',name:'999路',path:[[115.95,39.006],[116.05,39.006]]});
 const original=JSON.stringify(snapshot);
 const found=nearbyLines(snapshot,center,500);
 assert.equal(found.length,3);assert.ok(!found.some(item=>item.line.name==='999路'));assert.ok(found.every(item=>item.distance<=500));
 assert.equal(JSON.stringify(snapshot),original);
});
test('county clipping intersects segments whose endpoints are outside and reveals no geometry beyond the radius',()=>{
 const path:[number,number][]=[[115.9,39],[116.1,39],[116.1,39.01],[115.9,39.01]],original=JSON.stringify(path),clipped=clipRouteToRadius(path,center,3000);
 assert.ok(clipped.length>=2);for(const part of clipped)for(const point of part)assert.ok(distanceMeters(point,center)<=3000.0001);
 assert.equal(JSON.stringify(path),original);assert.equal(clipRouteToRadius([[117,40],[118,41]],center,3000).length,0);
 assert.equal(radiusRing(center,3000).length,97);
});
test('daily automatic positioning claims once per local day, and GPS conversion does not need a map API',()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)};
 assert.equal(claimDailyLocation(storage,new Date(2026,10,17,0,1)),true);assert.equal(claimDailyLocation(storage,new Date(2026,10,17,23,59)),false);
 assert.equal(claimDailyLocation(storage,new Date(2026,10,18,0,0)),true);assert.equal(values.size,1);
 const shifted=gpsToMap([116.397,39.908]);assert.ok(shifted[0]>116.4&&shifted[0]<116.41);assert.ok(shifted[1]>39.908&&shifted[1]<39.912);
 assert.deepEqual(gpsToMap([-74,40.7]),[-74,40.7]);assert.ok(![...values.values()].some(value=>value.includes('116')));
});
test('published county centers are explicitly saved government stops, not invented capitals',()=>{
 const snapshot=data();snapshot.stops.push({id:'generic',name:'地区政府',address:'1路',location:{lng:116,lat:39}});
 const seats=savedCountySeats(snapshot);assert.equal(seats.length,1);assert.equal(seats[0].name,'海淀区');assert.equal(seats[0].source,'government-stop');
 assert.equal(provinceForCity('北京'),'北京市');assert.equal(provinceForCity('阿克苏地区'),'新疆维吾尔自治区');
});
test('all offline modes use real saved answers and the chosen city; county windows stay clipped',()=>{
 const snapshot=data(),random=()=>.5;
 for(const mode of ['line','station','city','county'] as const){
  const county=savedCountySeats(snapshot)[0],question=createOfflineQuestion(mode,'medium',snapshot,mode==='county'?[county.name]:['北京市'],1,'',county,random);
  assert.ok(question.correctAnswer);assert.ok(question.options.includes(question.correctAnswer));
  if(mode==='line'||mode==='station')assert.ok(question.lineInfos?.every(line=>regularGameRoute(line.name)));
  if(mode==='city'||mode==='county')assert.equal(question.showBasemap,false);
  if(mode==='county'){
   assert.equal(question.countyWindow?.radius,10_000);
   assert.match(question.promptText,/10公里/);
   const distances=question.networkPaths!.flat().map(point=>distanceMeters(point,county.center));
   assert.ok(distances.some(distance=>distance>3000));
   assert.ok(distances.every(distance=>distance<=10_000.0001));
  }
 }
 const station=createOfflineQuestion('station','hell',snapshot,[],1);assert.ok(station.lineInfos?.every(line=>regularGameRoute(line.name)));
});
test('redesigned ladders apply the requested stage boundaries in both games',()=>{
 const snapshot=data();
 snapshot.lines.push(
  {id:'4',name:'12路(甲--乙)',city:'北京市',path:[[115.96,39.01],[116.06,39.01]],via_stops:[{name:'甲',location:{lng:115.96,lat:39.01}},{name:'中间',location:{lng:116,lat:39.01}},{name:'乙',location:{lng:116.06,lat:39.01}}]},
  {id:'5',name:'31路(甲--乙)',city:'北京市',path:[[115.96,39.02],[116.06,39.02]],via_stops:[{name:'甲',location:{lng:115.96,lat:39.02}},{name:'中间',location:{lng:116,lat:39.02}},{name:'乙',location:{lng:116.06,lat:39.02}}]}
 );
 for(const mode of ['line','station'] as const){
  assert.deepEqual(gameStage(mode,'easy',5),{showBasemap:true,showStops:true,isFillIn:false,confusing:false});
  assert.deepEqual(gameStage(mode,'easy',6),{showBasemap:true,showStops:true,isFillIn:false,confusing:true});
  assert.deepEqual(gameStage(mode,'easy',11),{showBasemap:false,showStops:true,isFillIn:false,confusing:true});
  assert.deepEqual(gameStage(mode,'easy',21),{showBasemap:false,showStops:false,isFillIn:false,confusing:true});
  assert.deepEqual(gameStage(mode,'hell',5),{showBasemap:true,showStops:true,isFillIn:true,confusing:false});
  assert.deepEqual(gameStage(mode,'hell',6),{showBasemap:false,showStops:true,isFillIn:true,confusing:false});
  assert.deepEqual(gameStage(mode,'hell',11),{showBasemap:false,showStops:false,isFillIn:true,confusing:false});
 }
 const early=createOfflineQuestion('line','easy',snapshot,[],5),late=createOfflineQuestion('line','easy',snapshot,[],21);
 assert.equal(early.showBasemap,true);assert.equal(early.showStops,true);assert.equal(late.showBasemap,false);assert.equal(late.showStops,false);
});
test('station distractors stay local and favour the nearest stops',()=>{
 const options=nearbyStationChoices('目标站',['最近甲','最近乙','最近丙','较远丁','更远戊'],()=>0);
 assert.ok(options.includes('目标站'));assert.deepEqual(options.filter(name=>name!=='目标站'),['最近甲','最近乙','最近丙']);
});
test('actual game generation never invokes provider search services and accepts only catalog cities',async()=>{
 const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration:ts.VariableDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='generateQuestion')declaration=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(declaration);
 const code=ts.transpile(`const ${declaration.getText(ast)};`,{target:ts.ScriptTarget.ES2022}),snapshot=data(),seat=savedCountySeats(snapshot)[0];
 let question: any;
 let drawing: ReturnType<typeof drawContestQuestion> | undefined;
 let contestExpired = false;
 const ref = <T,>(current: T) => ({ current });
 const scope = {
  gameRulesRef: ref(contestRules('line', ['unusual', 'fill'])), questionAbortRef: ref<AbortController | null>(null),
  gameProvince: '北京市', gameCountyProvince: '北京市', gameSessionIdRef: ref(0), activeContestRef: ref<{scope:string} | null>(null),
  loadPublishedCities: async () => [{city: snapshot.city, province: '北京市', countySeats: [seat]}],
  loadGameCity: async (city: string) => { assert.equal(city, snapshot.city); return snapshot; },
  loadGameCityImage: async () => 'fixture-image',
  roadViewportCleanupRef: ref(null), activeRawMarkersRef: ref([]), roadStopMarkersRef: ref([]),
  allMapStopsRef: ref(new Map()), roadStopsDataRef: ref(new Map()), lineGroupRef: ref(null), markerGroupRef: ref(null),
  clearStopMarkerGroup() {}, setCountyGameMask() {},
  createSimulationQuestion, drawContestQuestion, contestPrompts,
  gameTimeRemainingMsRef: ref(180000), questionShownAtRef: ref<number | null>(null), currentGameQuestionRef: ref<{correctAnswer:string} | null>(null),
  contestDeadlineRef: ref<number | null>(null), totalTimeLimitRef: ref<number | null>(null),
  accessibilityContextRef: ref(undefined),
  finishGameOnTimeout: (wholeContest: boolean) => { contestExpired = wholeContest; },
  setLocalGameDrawing: (value: typeof drawing) => { drawing = value; }, setGameQuestionData: (value: unknown) => { question = value; },
  isMinigameActiveRef: ref(true), restoreMapAfterMinigame() {}, setGameDataError: (message: string) => { throw Error(message); },
 };
 const proxy=new Proxy(scope,{has:(target,key)=>key in target||(typeof key==='string'&&key.startsWith('set')),get:(target,key)=>key in target?Reflect.get(target,key):typeof key==='string'&&key.startsWith('set')?()=>{}:undefined});
 const run=Function('scope',`with(scope){${code};return generateQuestion;}`)(proxy);
 for (const mode of ['line', 'city', 'county'] as const) {
  scope.gameRulesRef.current = contestRules(mode, mode === 'line' ? ['unusual','all-city','fill','time-5','network-only','no-stops'] : ['fill']);
  scope.questionShownAtRef.current = null;
  await run(mode,'北京市',12);
  assert.ok(question?.isFillIn);
  assert.deepEqual(question.options, []);
  assert.ok(mode === 'city' ? drawing?.raster : drawing?.path);
  assert.equal(question.correctAnswer, undefined);
  assert.ok(scope.currentGameQuestionRef.current?.correctAnswer);
  assert.equal(drawing?.county, mode === 'county');
  if (mode === 'line') assert.ok(drawing?.basemap);
  else assert.equal(drawing?.basemap ?? '', '');
  assert.equal(typeof scope.questionShownAtRef.current,'number');
  if (mode === 'line') {
   assert.equal(scope.gameTimeRemainingMsRef.current, 5000);
   assert.deepEqual(drawing?.stops, []);
  }
 }
 scope.gameRulesRef.current = contestRules('line', ['unusual', 'all-city', 'fill']);
 scope.activeContestRef.current = {scope:'北京市'};
 scope.totalTimeLimitRef.current = getContestTotalTime('line', true);
 await run('line','未收录城市',1);
 assert.ok(scope.currentGameQuestionRef.current?.correctAnswer);
 const deadline = scope.contestDeadlineRef.current;
 assert.equal(deadline, scope.questionShownAtRef.current! + getContestTotalTime('line', true)! * 1000);
 assert.equal(scope.gameTimeRemainingMsRef.current, 120000);
 await run('line','未收录城市',2);
 assert.equal(scope.contestDeadlineRef.current, deadline);
 scope.contestDeadlineRef.current = Date.now() - 1;
 await run('line','未收录城市',3);
 assert.equal(contestExpired, true);
 scope.activeContestRef.current = null;
 scope.contestDeadlineRef.current = null;
 await assert.rejects(run('line','未收录城市',1), /已有线路图/);
});

test('daily location effect waits for onboarding and runs only once across openings on the same day',()=>{
 const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect:ts.Node|undefined;
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('dailyLocationCheckedRef.current=true'))effect=node.arguments[0];ts.forEachChild(node,visit);};visit(ast);assert.ok(effect);
 const code=ts.transpile(`const effect=${effect.getText(ast)};`,{target:ts.ScriptTarget.ES2022});
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)};
 let attempts=0;const scope:any={dailyLocationCheckedRef:{current:false},mapInstance:{},loading:false,onboardingStep:2,showMinigameModal:false,navigator:{},localStorage:storage,claimDailyLocation,locateAndReadNearby:async()=>{attempts++;}};
 const run=Function('scope',`with(scope){${code};return effect;}`)(scope);
 run();assert.equal(attempts,0);scope.onboardingStep=0;scope.showMinigameModal=true;run();assert.equal(attempts,0);
 scope.showMinigameModal=false;run();assert.equal(attempts,1);run();assert.equal(attempts,1);
 scope.dailyLocationCheckedRef.current=false;run();assert.equal(attempts,1);
});

test('county mask replacement and removal do not leave overlays on the normal map',()=>{
 const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration:ts.VariableDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='setCountyGameMask')declaration=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(declaration);
 const code=ts.transpile(`const ${declaration.getText(ast)};`,{target:ts.ScriptTarget.ES2022});let added=0,removed=0;
 const scope={window:{AMap:{Polygon:class{constructor(public options:any){assert.equal(options.path.length,2);assert.equal(options.fillOpacity,1);}}}},mapRef:{current:{add(){added++;},remove(){removed++;}}},countyMaskRef:{current:null},radiusRing,COUNTY_GAME_RADIUS_METERS};
 const run=Function('scope',`with(scope){${code};return setCountyGameMask;}`)(scope);
 run(center);run([116.01,39],10_000);assert.equal(added,2);assert.equal(removed,1);run();assert.equal(removed,2);assert.equal(scope.countyMaskRef.current,null);
});

test('box and station connectivity draw complete priority routes without changing camera or zoom', async () => {
  const source = fs.readFileSync('src/App.tsx', 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, ts.VariableDeclaration>();
  const names = ['drawPriorityRoutes', 'showStopConnectivity', 'executeStationConnectivity'];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) declarations.set(node.name.getText(ast), node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const name of names) assert.ok(declarations.has(name));
  const code = ts.transpile(names.map(name => `const ${declarations.get(name)!.getText(ast)};`).join('\n'), { target: ts.ScriptTarget.ES2022 });
  const line = data().lines[0];
  const drawn: any[] = [], cities: string[] = [];
  let camera = 0;
  const scope: any = {
    window: { AMap: { Polyline: class { constructor(public options: unknown) {} } } },
    currentCity: '北京市', lineThickness: 'thick', lineGroupRef: { current: {} }, markerGroupRef: { current: {} },
    mapRef: { current: { setFitView() { camera++; }, setZoom() { camera++; }, setCenter() { camera++; } } },
    priorityCoverageRef: { current: { addOverlay: (overlay: any) => drawn.push(overlay.options) } },
    coverageVersionRef: { current: 0 }, searchVersionRef: { current: 0 }, isMinigameActiveRef: { current: false },
    boxSelectedStops: [{ city: '保定市', lines: ['1路'] }, { city: '廊坊市', lines: ['1路'] }],
    clearPriorityCoverage() { scope.coverageVersionRef.current++; },
    cityDataCache: { get: async (city: string) => { cities.push(city); return { ...data(), lines: [line] }; } },
    loadPublishedCities: async () => [],
    expandSavedStationCoverage,
    coverageLines: async (city: string) => { cities.push(city); return [line]; },
    setTimeout,
    fetch: () => { throw new Error('connectivity should not fetch AI summaries or live data'); },
  };
  const proxy = new Proxy(scope, {
    has: (target, key) => key in target || (typeof key === 'string' && key.startsWith('set')),
    get: (target, key) => key in target ? target[key] : typeof key === 'string' && key.startsWith('set') ? () => {} : undefined,
  });
  const run = Function('scope', `with(scope){${code};return {showStopConnectivity,executeStationConnectivity};}`)(proxy);
  await run.showStopConnectivity(['1路']);
  await run.executeStationConnectivity({ city: '北京市', name: '海淀区政府', location: center }, 0);
  assert.deepEqual(cities, ['保定市', '廊坊市', '北京市']);
  assert.equal(drawn.length, 3);
  assert.ok(drawn.every(overlay => overlay.zIndex >= 75));
  for (const overlay of drawn) assert.deepEqual(overlay.path, [line.path]);
  assert.equal(camera, 0);
});

test('published game catalog reads only same-origin static data and refreshes cached cities after a publication',async()=>{
 const {normalizeQuizCatalog}=await import('../src/utils/cityOverview');
 const source=fs.readFileSync('src/utils/publishedTransit.ts','utf8').replaceAll('import.meta.env.BASE_URL',"'/'"),code=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
 let reads=0,downloads=0,revision='a'.repeat(40);const snapshot=data(),exports:any={};
 const city={city:snapshot.city,center,bounds:[115,38,117,40],thumbnail:'thumbnails/北京-geo-v3.png',lineDirections:3,capturedAt:snapshot.capturedAt,countySeats:savedCountySeats(snapshot)};
 const cityDataCache=new CityDataCache(async()=>{throw Error('Game reads use the bounded loader');});
 const require=(name:string)=>name==='./cityOverview'?{normalizeQuizCatalog}:name==='./localTransit'?{provinceForCity}:name==='./sharedCityClient'?{loadSharedCityForGame:async(city:string)=>{assert.equal(city,snapshot.city);downloads++;return snapshot;}}:{cityDataCache};
 const globalThis={fetch:async(url:string)=>{assert.ok(url.startsWith('/city-data/v1/overview.json'));assert.ok(!url.includes('amap'));reads++;return {ok:true,json:async()=>({cities:[city],tiles:{revision}})};}};
 Function('exports','require','globalThis','AbortSignal',code)(exports,require,globalThis,AbortSignal);
 const catalog=await exports.loadPublishedCities();assert.equal(catalog[0].province,'北京市');assert.equal(catalog[0].countySeats[0].source,'government-stop');
 await exports.loadPublishedCities();assert.equal(reads,1);
 await exports.loadGameCity('北京市');await exports.loadGameCity('北京市');assert.equal(downloads,1);
 revision='b'.repeat(40);await exports.loadPublishedCities(true);assert.equal(reads,2);await exports.loadGameCity('北京市');assert.equal(downloads,2);
});


test('an unanswered timed-out question is reviewable as wrong and can only be recorded once', () => {
  const snapshot = { questionNum: 1, correctAnswer: '1路', lineInfos: [{ name: '1路' }] };
  const pending = { current: snapshot as typeof snapshot | null };
  assert.deepEqual(recordGameAnswer(pending, '', false, true), {
    ...snapshot, userAnswer: '', isCorrect: false, timedOut: true,
  });
  assert.equal(recordGameAnswer(pending, '1路', true), null);
  pending.current = snapshot;
  assert.equal(recordGameAnswer(pending, '1路', true)?.isCorrect, true);
  assert.equal(recordGameAnswer(pending, '', false, true), null);
});


test('saved station coverage follows every stop up to the requested transfer layer across cities', async () => {
  const route = (name: string, stops: [string, number][]) => ({
    ...data().lines[0], id: name, name,
    path: stops.map(([, lng]): [number, number] => [lng, 39]),
    via_stops: stops.map(([name, lng]) => ({ name, location: { lng, lat: 39 } })),
  });
  const direct = route('直达', [['起点', 116], ['甲站', 116.01], ['乙站', 116.02]]);
  const cities = {
    北京市: { ...data(), lines: [direct, route('甲站接驳', [['甲站', 116.01], ['丙站', 116.03]])] },
    廊坊市: { ...data(), city: '廊坊市', lines: [
      direct,
      route('乙站接驳', [['乙站公交站', 116.02], ['丁站', 116.04]]),
      route('二次换乘', [['丁站', 116.04], ['戊站', 116.05]]),
      route('三次换乘', [['戊站', 116.05], ['己站', 116.06]]),
      route('同名远站', [['起点', 116.1], ['其他站', 116.11]]),
    ] },
  };
  const catalog = [{ city: '廊坊市', bounds: [116.01, 38.99, 116.12, 39.01] as [number, number, number, number] }];
  const expected = [['直达'], ['甲站接驳', '乙站接驳'], ['二次换乘']];
  for (const depth of [0, 1, 2] as const) {
    const layers: string[][] = [], reads: string[] = [];
    const result = await expandSavedStationCoverage({ city: '北京市', name: '起点公交站', location: center }, depth, catalog,
      async city => { reads.push(city); return cities[city as keyof typeof cities] ?? null; },
      () => false, async lines => { layers.push(lines.map(line => line.name)); });
    assert.deepEqual(layers, expected.slice(0, depth + 1));
    assert.deepEqual(reads, depth ? ['北京市', '廊坊市'] : ['北京市']);
    assert.equal(result.unavailable, false);
  }
});
