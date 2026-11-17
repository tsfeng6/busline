import assert from 'node:assert/strict';
import test from 'node:test';
import {cityThumbnail} from '../src/utils/cityOverview';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {mirrorCitySnapshots} from '../scripts/publish-city-static';

test('overview covers all route bounds with a bounded raster and never changes source coordinates',()=>{
 const data={city:'测试市',capturedAt:'2026-11-17T00:00:00Z',lines:[{path:[[116.123456789123,39.987654321098],[116.5,40],[116,39]] as [number,number][]}]};
 const original=JSON.stringify(data);const result=cityThumbnail(data)!;
 assert.deepEqual(result.meta.bounds,[116,39,116.5,40]);assert.ok(result.svg.includes('<path d="M'));
 assert.ok(result.svg.length<160*100*16);assert.equal(JSON.stringify(data),original);
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
 for(const city of index.cities){const svg=readFileSync(join(output,'city-data/v1',decodeURIComponent(city.thumbnail)),'utf8');assert.ok(svg.startsWith('<svg'));assert.equal(city.lineDirections,1);}
 }finally{rmSync(root,{recursive:true,force:true});}
});
