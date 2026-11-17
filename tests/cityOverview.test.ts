import assert from 'node:assert/strict';
import test from 'node:test';
import {cityThumbnail,overviewPixel,mercatorY,validCityOverview} from '../src/utils/cityOverview';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {mirrorCitySnapshots} from '../scripts/publish-city-static';

test('overview covers all route bounds with a bounded raster and never changes source coordinates',()=>{
 const data={city:'测试市',capturedAt:'2026-11-17T00:00:00Z',lines:[{path:[[116.123456789123,39.987654321098],[116.5,40],[116,39]] as [number,number][]}]};
 const original=JSON.stringify(data);const result=cityThumbnail(data)!;
 assert.deepEqual(result.meta.bounds,[116,39,116.5,40]);assert.ok(result.svg.includes('<path d="M'));
 assert.ok(result.svg.length<512*512*16);assert.ok(!result.svg.includes('<rect'));assert.ok(result.svg.includes('preserveAspectRatio="none"'));assert.equal(JSON.stringify(data),original);
 assert.equal(cityThumbnail({...data,lines:[]}),null);
});
test('publication creates a tiny national index and a thumbnail for every valid latest city, without embedding full routes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'busline-overview-'));
 try{
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 for(const city of ['北京','廊坊']){const prefix=join(root,'city-data/v1',city);mkdirSync(prefix,{recursive:true});
 writeFileSync(join(prefix,'latest.json'),JSON.stringify({schemaVersion:1,city:city+'市',capturedAt:'2026-11-17T00:00:00Z',lines:[{path:[[116,39],[116.2,39.5]]}],stops:[]}));}
 git('add','.');git('commit','-m','fixtures');
 const output=join(root,'out');await mirrorCitySnapshots('HEAD',output,root);
 const text=readFileSync(join(output,'city-data/v1/overview.json'),'utf8'),index=JSON.parse(text);
 assert.equal(index.cities.length,2);assert.ok(text.length<2000);assert.ok(!text.includes('"path"'));
 for(const city of index.cities){const png=readFileSync(join(output,'city-data/v1',decodeURIComponent(city.thumbnail)));assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(city.lineDirections,1);}
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('geographic thumbnail maps corners and Mercator midpoints to their real image positions',()=>{
 const bounds:[number,number,number,number]=[100,20,120,60];
 assert.deepEqual(overviewPixel([100,60],bounds,512,256),[0,0]);
 assert.deepEqual(overviewPixel([120,20],bounds,512,256),[511,255]);
 const middle=180/Math.PI*(2*Math.atan(Math.exp((mercatorY(20)+mercatorY(60))/2*Math.PI/180))-Math.PI/2);
 const pixel=overviewPixel([110,middle],bounds,512,256);
 assert.ok(Math.abs(pixel[0]-255.5)<1e-9);assert.ok(Math.abs(pixel[1]-127.5)<1e-9);
 const item={city:'北京',bounds,thumbnail:'thumbnails/%E5%8C%97%E4%BA%AC-geo-v2.svg'};
 assert.equal(validCityOverview(item),true);assert.equal(validCityOverview({...item,bounds:[120,60,100,20]}),false);
 assert.equal(validCityOverview({...item,thumbnail:'../private'}),false);
});


test('geographic PNG has transparent background and draws only the original projected raster pixels',async()=>{
 const {cityOverviewPNG}=await import('../scripts/city-overview-png');
 const {inflateSync}=await import('node:zlib');
 const pixels=new Uint8Array([1,0,0,1]),png=cityOverviewPNG({width:2,height:2,pixels});
 let at=8;const compressed:Buffer[]=[];
 while(at<png.length){const size=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8);if(type==='IDAT')compressed.push(png.subarray(at+8,at+8+size));at+=size+12;}
 const rows=inflateSync(Buffer.concat(compressed));
 assert.equal(rows[4],255);assert.equal(rows[8],0);assert.equal(rows[13],0);assert.equal(rows[17],255);
});

test('each overview zoom has geographically correct XYZ tiles; missing tiles need no network request',async()=>{
 const {CityOverviewTiles,worldPixel,TILE_MIN_ZOOM,TILE_MAX_ZOOM}=await import('../scripts/city-overview-tiles');
 const {validTileIndex,CITY_DETAIL_ZOOM}=await import('../src/utils/cityOverview');
 const path:[number,number][]=[[116.123456789123,39.987654321098],[116.15,40]];
 const original=JSON.stringify(path),tiles=new CityOverviewTiles();tiles.add({lines:[{path}]});
 for(let z=TILE_MIN_ZOOM;z<=TILE_MAX_ZOOM;z++){
  const [x,y]=worldPixel(path[0],z);assert.ok(tiles.keys.includes(`${z}/${Math.floor(x/256)}/${Math.floor(y/256)}`));
  const larger=worldPixel(path[0],z+1);assert.ok(Math.abs(larger[0]-x*2)<1e-7);assert.ok(Math.abs(larger[1]-y*2)<1e-7);
 }
 assert.equal(JSON.stringify(path),original);assert.equal(CITY_DETAIL_ZOOM,13);
 const index={base:'tiles/xyz-v1',revision:'a'.repeat(40),minZoom:2,maxZoom:13,keys:tiles.keys};
 assert.equal(validTileIndex(index),true);assert.equal(validTileIndex({...index,base:'https://external.example'}),false);
 assert.equal(validTileIndex({...index,keys:['13/999999/0']}),false);
 for(const file of tiles.files(index.base))assert.deepEqual([...file.content.subarray(0,8)],[137,80,78,71,13,10,26,10]);
});
