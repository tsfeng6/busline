import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {regularGameRoute,eligibleGameLines,clipRouteToRadius,distanceMeters,nearbyLines,gpsToMap,claimDailyLocation,savedCountySeats,provinceForCity,radiusRing} from '../src/utils/localTransit';
import {createOfflineQuestion,shuffle} from '../src/utils/offlineGame';
import {CityDataCache} from '../src/utils/cityDataCache';
import {normalizeCityDataset} from '../src/utils/cityDataset';
const center:[number,number]=[116,39];
const data=()=>normalizeCityDataset({schemaVersion:1,city:'北京市',scope:'city',coverage:'observed',filtered:false,retrievalComplete:true,capturedAt:new Date().toISOString(),
 stops:[{id:'s',name:'海淀区政府',address:'1路;X107路',location:{lng:116,lat:39}},{id:'t',name:'东站',address:'1路',location:{lng:116.01,lat:39}}],
 lines:[{id:'1',name:'1路(甲--乙)',city:'北京市',path:[[115.95,39],[116.05,39]],via_stops:[{name:'海淀区政府',location:{lng:116,lat:39}},{name:'东站',location:{lng:116.01,lat:39}}]},
 {id:'2',name:'X107路(甲--乙)',city:'北京市',path:[[116,38.95],[116,39.05]],via_stops:[{name:'海淀区政府',location:{lng:116,lat:39}}]},
 {id:'3',name:'快速直达专线187路',city:'北京市',path:[[115.95,38.95],[116.05,39.05]],via_stops:[{name:'海淀区政府',location:{lng:116,lat:39}}]}]});
test('regular difficulties accept numeric routes and simple prefixes/suffixes, while hell retains every saved route',()=>{
 for(const name of ['1路','368路','X107路','兴33路','黎城5路','368快路','围场8路','300路内环','M191路(甲--乙)'])assert.equal(regularGameRoute(name),true,name);
 for(const name of ['快速直达专线187路','节假日5路','北京密码','机场巴士','机场5路','地铁1号线','市郊铁路S2线','商务班车1路','旅游专线2路'])assert.equal(regularGameRoute(name),false,name);
 assert.equal(eligibleGameLines(data().lines,'easy').length,2);assert.equal(eligibleGameLines(data().lines,'hell').length,3);
 const special={...data(),lines:[data().lines[2]]};assert.throws(()=>createOfflineQuestion('line','easy',special,[],1),/常规线路/);
 assert.equal(createOfflineQuestion('line','hell',special,[],1).correctAnswer,'快速直达专线187路');
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
  if(mode==='county'){assert.equal(question.countyWindow?.radius,3000);assert.ok(question.networkPaths?.every(path=>path.every(point=>distanceMeters(point,county.center)<=3000.0001)));}
 }
 const station=createOfflineQuestion('station','hell',snapshot,[],1);assert.ok(station.lineInfos?.some(line=>line.name.includes('专线')));
});
test('actual game generation never invokes provider search services and accepts only catalog cities',async()=>{
 const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration:ts.VariableDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='generateQuestion')declaration=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(declaration);
 const code=ts.transpile(`const ${declaration.getText(ast)};`,{target:ts.ScriptTarget.ES2022}),snapshot=data(),seat=savedCountySeats(snapshot)[0];
 let calls=0,question:any;const ref=(current:any)=>({current});
 const forbidden=class{constructor(){calls++;throw Error('No provider query permitted');}};
 const scope:any={window:{AMap:{PlaceSearch:forbidden,LineSearch:forbidden,StationSearch:forbidden,DistrictSearch:forbidden,Geocoder:forbidden,
  Polyline:class{},CircleMarker:class{},Bounds:class{}}},mapInstance:{setFitView(){},setZoomAndCenter(){},setBounds(){}},gameProvince:'北京市',gameCountyProvince:'北京市',gameSessionIdRef:ref(0),
  loadPublishedCities:async()=>[{city:snapshot.city,province:'北京市',countySeats:[seat]}],loadGameCity:async(city:string)=>{assert.equal(city,snapshot.city);return snapshot;},
  roadViewportCleanupRef:ref(null),activeRawMarkersRef:ref([]),roadStopMarkersRef:ref([]),allMapStopsRef:ref(new Map()),roadStopsDataRef:ref(new Map()),
  lineGroupRef:ref({clearOverlays(){},addOverlay(){}}),markerGroupRef:ref({clearOverlays(){},getOverlays(){return [];},addOverlay(){},addOverlays(){}}),clearStopMarkerGroup(){},
  shuffle,createOfflineQuestion,radiusRing,lineThickness:'thin',currentGameQuestionRef:ref(null),setGameQuestionData:(value:any)=>question=value,
  isMinigameActiveRef:ref(true),restoreMapAfterMinigame(){},setGameDataError:(message:string)=>{throw Error(message);}};
 const proxy=new Proxy(scope,{has:(target,key)=>key in target||(typeof key==='string'&&key.startsWith('set')),get:(target,key)=>key in target?target[key]:typeof key==='string'&&key.startsWith('set')?()=>{}:undefined});
 const run=Function('scope',`with(scope){${code};return generateQuestion;}`)(proxy);
 for(const mode of ['line','station','city','county']){question=null;await run(mode,'easy','北京市',1);assert.ok(question);}
 assert.equal(calls,0);
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
 const scope={window:{AMap:{Polygon:class{constructor(public options:any){assert.equal(options.path.length,2);assert.equal(options.fillOpacity,1);}}}},mapRef:{current:{add(){added++;},remove(){removed++;}}},countyMaskRef:{current:null},radiusRing};
 const run=Function('scope',`with(scope){${code};return setCountyGameMask;}`)(scope);
 run(center,3000);run([116.01,39],3000);assert.equal(added,2);assert.equal(removed,1);run();assert.equal(removed,2);assert.equal(scope.countyMaskRef.current,null);
});

test('both connectivity search entry points draw routes without changing map center or zoom',async()=>{
 const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),declarations=new Map<string,ts.VariableDeclaration>();
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&['showStopConnectivity','executeStationConnectivity'].includes(node.name.getText(ast)))declarations.set(node.name.getText(ast),node);ts.forEachChild(node,visit);};visit(ast);
 let drawn=0,camera=0;const line=data().lines[0];
 const scope:any={window:{AMap:{LineSearch:class{search(_name:string,callback:any){callback('complete',{lineInfo:[line]});}}}},currentCity:'北京市',
  lineGroupRef:{current:{clearOverlays(){}}},markerGroupRef:{current:{}},mapRef:{current:{setFitView(){camera++;},setZoom(){camera++;},setCenter(){camera++;}}},
  clearStopMarkerGroup(){},setTimeout,clearTimeout,parseLineInfo:(name:string)=>({name}),checkAmapQuotaError(){},isLineNameBlockedRef:()=>false,
  renderBusLine:(...args:any[])=>{assert.equal(args[5],false);drawn++;},fetch:async()=>({json:async()=>({summary:'summary'})})};
 const proxy=new Proxy(scope,{has:(target,key)=>key in target||(typeof key==='string'&&key.startsWith('set')),get:(target,key)=>key in target?target[key]:typeof key==='string'&&key.startsWith('set')?()=>{}:undefined});
 for(const name of ['showStopConnectivity','executeStationConnectivity']){
  const declaration=declarations.get(name);assert.ok(declaration);const code=ts.transpile(`const ${declaration.getText(ast)};`,{target:ts.ScriptTarget.ES2022});
  const run=Function('scope',`with(scope){${code};return ${name};}`)(proxy);
  if(name==='showStopConnectivity')await run(['1路']);else await run({name:'海淀区政府',lines:['1路']},new Set(),false,0);
 }
 assert.equal(drawn,2);assert.equal(camera,0);
});

test('published game catalog reads only same-origin static data and refreshes cached cities after a publication',async()=>{
 const {validCityOverview}=await import('../src/utils/cityOverview');
 const source=fs.readFileSync('src/utils/publishedTransit.ts','utf8').replace('import.meta.env.BASE_URL',"'/'"),code=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
 let reads=0,downloads=0,revision='a'.repeat(40);const snapshot=data(),exports:any={};
 const city={city:snapshot.city,center,bounds:[115,38,117,40],thumbnail:'thumbnails/北京-geo-v3.png',lineDirections:3,capturedAt:snapshot.capturedAt,countySeats:savedCountySeats(snapshot)};
 const cityDataCache=new CityDataCache(async city=>{assert.equal(city,snapshot.city);downloads++;return snapshot;});
 const require=(name:string)=>name==='./cityOverview'?{validCityOverview}:name==='./localTransit'?{provinceForCity}:{cityDataCache};
 const globalThis={fetch:async(url:string)=>{assert.ok(url.startsWith('/city-data/v1/overview.json'));assert.ok(!url.includes('amap'));reads++;return {ok:true,json:async()=>({cities:[city],tiles:{revision}})};}};
 Function('exports','require','globalThis','AbortSignal',code)(exports,require,globalThis,AbortSignal);
 const catalog=await exports.loadPublishedCities();assert.equal(catalog[0].province,'北京市');assert.equal(catalog[0].countySeats[0].source,'government-stop');
 await exports.loadPublishedCities();assert.equal(reads,1);
 await exports.loadGameCity('北京市');await exports.loadGameCity('北京市');assert.equal(downloads,1);
 revision='b'.repeat(40);await exports.loadPublishedCities(true);assert.equal(reads,2);await exports.loadGameCity('北京市');assert.equal(downloads,2);
});
