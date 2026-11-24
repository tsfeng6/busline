import assert from 'node:assert/strict';
import test from 'node:test';
import {cityThumbnail,overviewPixel,mercatorY,validCityOverview,overviewStrokeWidth,transitStrokeWidth} from '../src/utils/cityOverview';
import {tileLngLat} from '../src/utils/transitTiles';

test('default line width matches the raster at handoff and only increases in the final zoom level', () => {
 assert.equal(transitStrokeWidth(13,20,true),overviewStrokeWidth(13));
 assert.equal(transitStrokeWidth(19,20,true),3);
 assert.equal(transitStrokeWidth(19.5,20,true),3.625);
 assert.equal(transitStrokeWidth(20,20,true),4.25);
 assert.equal(transitStrokeWidth(21,20,true),4.25);
 assert.equal(transitStrokeWidth(18,18,true),4.25);
});
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {mirrorCitySnapshots} from '../scripts/publish-city-static';
import {CityOverviewTiles, OVERVIEW_RASTER_SIZE, TILE_PIXEL_RATIO, TILE_SIZE} from '../scripts/city-overview-tiles';

test('nearby parallel lines leave a transparent gap in the regional overview', () => {
  const z = 7, x = 105, y = 48;
  const tiles = new CityOverviewTiles();
  tiles.add({lines:[100, 102].map(row => ({
    path: [80, 120].map(column => tileLngLat([x + column / TILE_SIZE, y + row / TILE_SIZE], z)),
  }))});
  const pixels = tiles.rawPixels(`${z}/${x}/${y}`);
  const alpha = (row: number) => pixels[(row * OVERVIEW_RASTER_SIZE + 100) * TILE_PIXEL_RATIO];
  assert.ok(alpha(100) > 0);
  assert.equal(alpha(101), 0);
  assert.ok(alpha(102) > 0);
});

test('per-city tile layers serialize and merge back losslessly', () => {
  const a = new CityOverviewTiles({ cacheDirectory: join(mkdtempSync(join(tmpdir(), 'busline-layer-')), 'a') });
  const b = new CityOverviewTiles({ cacheDirectory: join(mkdtempSync(join(tmpdir(), 'busline-layer-')), 'b') });
  a.add({ lines: [{ path: [[116, 39], [116.5, 39.5]] as [number, number][] }] });
  b.add({ lines: [{ path: [[116.2, 39.2], [116.4, 39.4]] as [number, number][] }] });
  const merged = new CityOverviewTiles({ cacheDirectory: join(mkdtempSync(join(tmpdir(), 'busline-layer-')), 'm') });
  merged.mergeLayer(a);
  merged.mergeSerializedLayer(a.serializeLayer()); // max merge is idempotent
  merged.mergeLayer(b);
  const aKeys = new Set(a.keys), bKeys = new Set(b.keys);
  for (const key of merged.keys) assert.ok(aKeys.has(key) || bKeys.has(key));
  const restored = new CityOverviewTiles({ cacheDirectory: join(mkdtempSync(join(tmpdir(), 'busline-layer-')), 'r') });
  restored.mergeSerializedLayer(a.serializeLayer());
  assert.deepEqual(restored.keys, a.keys);
  for (const key of a.keys) assert.deepEqual(restored.rawPixels(key), a.rawPixels(key));
});

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
 writeFileSync(join(prefix,'latest.json'),JSON.stringify({schemaVersion:1,city:city+'市',capturedAt:'2026-11-17T00:00:00Z',lines:[{path:[[116,39],[116.2,39.5]]}],stops:city==='北京'?[{name:'海淀区政府',location:{lng:116,lat:39}}]:[]}));}
 git('add','.');git('commit','-m','fixtures');
 const output=join(root,'out');await mirrorCitySnapshots('HEAD',output,root);
 const text=readFileSync(join(output,'city-data/v1/overview.json'),'utf8'),index=JSON.parse(text);
 assert.equal(index.cities.length,2);assert.equal(index.cities.find((city:any)=>city.city==='北京市').province,'北京市');assert.equal(index.cities.find((city:any)=>city.city==='北京市').countySeats[0].name,'海淀区');assert.ok(text.length<3000);assert.ok(!text.includes('"path"'));
 for(const city of index.cities){const png=readFileSync(join(output,'city-data/v1',decodeURIComponent(city.thumbnail)));assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(city.lineDirections,1);}
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('incremental publish reuses unchanged city tile layers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'busline-incremental-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    const prefix = join(root, 'city-data/v1', '北京'); mkdirSync(prefix, { recursive: true });
    writeFileSync(join(prefix, 'latest.json'), JSON.stringify({ schemaVersion: 1, city: '北京市', capturedAt: '2026-11-17T00:00:00Z', lines: [{ path: [[116, 39], [116.2, 39.5]] }], stops: [] }));
    writeFileSync(join(prefix, 'meta.json'), JSON.stringify({ schemaVersion: 1, city: '北京市', capturedAt: '2026-11-17T00:00:00Z', retrievalComplete: true, filtered: false, lineDirections: 1, stops: 0, snapshotId: '2026-11-17T00-00-00-000Z-abcdef123456' }));
    git('add', '.'); git('commit', '-m', 'fixtures');
    const layersDir = join(root, 'layers');
    const first = await mirrorCitySnapshots('HEAD', join(root, 'out1'), root, layersDir);
    assert.equal(first.reused, 0);
    const second = await mirrorCitySnapshots('HEAD', join(root, 'out2'), root, layersDir);
    assert.equal(second.reused, 1);
    assert.deepEqual(readFileSync(join(root, 'out1', 'city-data/v1/overview.json')), readFileSync(join(root, 'out2', 'city-data/v1/overview.json')));
    assert.ok(existsSync(join(layersDir, '北京', 'coverage.gz')));
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test('HD XYZ tiles retain original bounds at 3x density and have antialiased transparent edges',async()=>{
 const {CityOverviewTiles,TILE_PIXEL_RATIO,OVERVIEW_RASTER_SIZE}=await import('../scripts/city-overview-tiles');
 const {inflateSync}=await import('node:zlib');
 const tiles=new CityOverviewTiles();tiles.add({lines:[{path:[[116.1234,39.9876],[116.151,40.001]]}]});
 assert.equal(TILE_PIXEL_RATIO,3);let partial=false,clear=false,solid=false;
 for(const file of tiles.files('tiles/xyz-v1')){
  assert.equal(file.content.readUInt32BE(16),OVERVIEW_RASTER_SIZE);assert.equal(file.content.readUInt32BE(20),OVERVIEW_RASTER_SIZE);
  const compressed:Buffer[]=[];for(let at=8;at<file.content.length;){const size=file.content.readUInt32BE(at);if(file.content.toString('ascii',at+4,at+8)==='IDAT')compressed.push(file.content.subarray(at+8,at+8+size));at+=size+12;}
  const rows=inflateSync(Buffer.concat(compressed));
  for(let y=0;y<OVERVIEW_RASTER_SIZE;y++)for(let x=0;x<OVERVIEW_RASTER_SIZE;x++){const alpha=rows[y*(OVERVIEW_RASTER_SIZE*4+1)+1+x*4+3];if(alpha===0)clear=true;else if(alpha===255)solid=true;else partial=true;}
 }
 assert.ok(clear&&solid&&partial);
});

test('disk-backed tile generation stays bounded and preserves every pixel across evictions and overlapping cities',async()=>{
 const {CityOverviewTiles,OVERVIEW_RASTER_SIZE}=await import('../scripts/city-overview-tiles');
 const root=mkdtempSync(join(tmpdir(),'busline-tile-spill-test-'));
 try{
  const memory=new CityOverviewTiles(),disk=new CityOverviewTiles({cacheDirectory:root,maxResidentTiles:1});
  const cities=[
   {lines:[{path:[[116.1234,39.9876],[116.151,40.001]] as [number,number][]}]},
   {lines:[{path:[[121.49,31.23],[121.51,31.25]] as [number,number][]}]},
   {lines:[{path:[[116.1235,39.9877],[116.16,40.002]] as [number,number][]}]},
  ];
  for(const city of cities){memory.add(city);disk.add(city);assert.ok(disk.residentBytes<=OVERVIEW_RASTER_SIZE**2);}
  assert.ok(disk.keys.length>20);assert.deepEqual(disk.keys,memory.keys);
  const expected=new Map([...memory.files('tiles')].map(file=>[file.path,file.content]));
  for(let pass=0;pass<2;pass++)for(const file of disk.files('tiles'))assert.deepEqual(file.content,expected.get(file.path));
  assert.ok(disk.residentBytes<=OVERVIEW_RASTER_SIZE**2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
