import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteRenderIndex, offsetRoutePath, type Point } from '../src/utils/routeRenderIndex';
import { lazyStopMarker, viewportStopMarkers, syncLazyMarkers, clearStopMarkerGroup } from '../src/utils/lazyStopMarker';
import { cityRecords, cityUploadBlob, cityBlobHash, MAX_CITY_BYTES } from '../src/utils/cityTransfer';
import { createHash } from 'node:crypto';

test('compact road index agrees with an exhaustive segment scan and keeps every coordinate', () => {
  const paths: Point[][] = Array.from({length:6},(_,r)=>Array.from({length:1025},(_,i)=>[116+i*.00001,39+Math.sin(i*.2+r)*.0001]));
  const source=JSON.stringify(paths), routes=paths.map((path,i)=>({name:String(i),path,displayPath:offsetRoutePath(path)}));
  const index=new RouteRenderIndex(routes);
  assert.equal(index.blockCount,6*8);
  assert.equal(JSON.stringify(paths),source);
  for(let i=0;i<20;i++){
    const point:Point=[116+i*.0004,39],radius=.00005;
    const expected:string[]=[];
    for(const route of routes)for(let j=0;j<route.displayPath.length-1;j++){
      const a=route.displayPath[j],b=route.displayPath[j+1],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));
      if(Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)<radius)expected.push(`${route.name}:${j}`);
    }
    const actual=index.query(point,radius).map(hit=>`${[...hit.lines][0]}:${paths[Number([...hit.lines][0])].indexOf(hit.data.start)}`);
    assert.deepEqual(actual,expected);
  }
  const visible=index.visiblePaths({minLng:116.001,maxLng:116.002,minLat:38.99,maxLat:39.01});
  assert.ok([...visible.values()].flat().reduce((n,path)=>n+path.length,0)<paths.flat().length/2);
  for(const route of routes)assert.equal(route.displayPath.length,route.path.length);
});

test('10,000 offscreen station descriptors allocate no map objects and release objects after panning', () => {
  let created=0,released=0;
  class Marker { constructor(public options:any){created++;}on(){}off(){}setOptions(){}setMap(){}destroy(){released++;} }
  const descriptors=Array.from({length:10000},(_,i)=>lazyStopMarker({CircleMarker:Marker},{center:[116+i*.001,39],extData:{key:String(i)}}));
  assert.equal(created,0);
  let west=116;
  const map={getZoom:()=>16,getBounds:()=>({getSouthWest:()=>({lng:west,lat:38.99}),getNorthEast:()=>({lng:west+.01,lat:39.01})})};
  let attached:any[]=[];
  const group={getOverlays:()=>attached,addOverlays:(a:any[])=>attached.push(...a),removeOverlays:(a:any[])=>{attached=attached.filter(x=>!a.includes(x));},clearOverlays:()=>{attached=[];}};
  syncLazyMarkers(group,viewportStopMarkers(descriptors,map));
  assert.ok(created<20);
  const firstCreated=created;
  syncLazyMarkers(group,viewportStopMarkers(descriptors,map));
  assert.equal(created,firstCreated);
  west=120;
  syncLazyMarkers(group,viewportStopMarkers(descriptors,map));
  assert.equal(released,firstCreated);
  clearStopMarkerGroup(group);
  assert.equal(released,created);
});

test('record serialization has bounded chunks, lossless coordinates and a deterministic integrity hash', async () => {
  const data:any={schemaVersion:1,city:'北京市',scope:'city',coverage:'observed',filtered:false,retrievalComplete:true,capturedAt:new Date().toISOString(),
    stops:[{id:'s',name:'中文站点',location:{lng:116,lat:39}}],lines:[{name:'线路',path:Array.from({length:50000},(_,i)=>[116+i/1e9,39+i/1e9])}]};
  assert.equal(MAX_CITY_BYTES,1073741824);
  const blob=await cityUploadBlob(data);
  assert.ok(blob.size>256*1024);
  assert.equal(await blob.text(),[...cityRecords(data)].join(''));
  const hash=createHash('sha256');
  for(let at=0;at<blob.size;at+=256*1024)hash.update(createHash('sha256').update(Buffer.from(await blob.slice(at,at+256*1024).arrayBuffer())).digest());
  assert.equal(await cityBlobHash(blob),hash.digest('hex'));
});

test('timeline only instantiates active in-view lines and preserves paths when time changes', async () => {
  const {lazyTimelineRoute}=await import('../src/utils/lazyTimelineRoute');
  let created=0,removed=0,drawn:any=null;
  class Polyline {constructor(options:any){created++;drawn=options.path;}on(){}off(){}destroy(){}setOptions(){}setPath(paths:any){drawn=paths;}}
  const map={add(){},remove(){removed++;}};
  const route=lazyTimelineRoute(map,{Polyline},{},()=>{}),paths=[[[116.123456789,39],[116.234567891,39.1]]];
  route.hide();route.setPaths(paths);assert.equal(created,0);
  route.show();assert.equal(created,1);assert.equal(drawn,paths);route.setOptions({strokeWeight:3});
  route.hide();assert.equal(removed,1);
  route.show();assert.equal(created,2);assert.equal(drawn,paths);
  route.setPaths([]);assert.equal(removed,2);
  route.destroy();assert.equal(removed,2);
});
