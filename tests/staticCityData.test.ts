import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mirrorCitySnapshots} from '../scripts/publish-city-static';
import {readCityJSON,sharedCityStaticURL} from '../src/utils/sharedCityRead';

test('all city reads are same-origin and do not contact an upload gateway on failure',async()=>{
  assert.equal(sharedCityStaticURL('北京市'),'/city-data/v1/%E5%8C%97%E4%BA%AC/latest.json');
  assert.equal(sharedCityStaticURL('北京','history','','/busline/'),'/busline/city-data/v1/%E5%8C%97%E4%BA%AC/history.json');
  assert.throws(()=>sharedCityStaticURL('北京','','','https://worker.example'),/同源/);
  assert.throws(()=>sharedCityStaticURL('北京','../secret'),/版本/);
  const calls:string[]=[];
  assert.deepEqual(await readCityJSON(sharedCityStaticURL('北京'),async input=>{
    calls.push(String(input));return Response.json({city:'北京市'});
  }),{city:'北京市'});
  assert.equal(calls.length,1);
  await assert.rejects(()=>readCityJSON(sharedCityStaticURL('北京'),async input=>{
    calls.push(String(input));return new Response(null,{status:404});
  }),(e:any)=>e.status===404);
  assert.ok(calls.every(url=>url.startsWith('/city-data/')));
  await assert.rejects(()=>readCityJSON('https://gateway.example',async()=>{throw Error('must not fetch');}),/同源/);
  const client=readFileSync('src/utils/sharedCityClient.ts','utf8');
  assert.ok(!client.includes('VITE_CITY_DATA_READ_BASE_URL'));
  assert.ok(client.includes('readCityJSON(sharedCityStaticURL('));
});
test('transient static read failures retry the same file and stay distinct from missing data',async()=>{
  let count=0;
  assert.deepEqual(await readCityJSON('/city-data/v1/北京/latest.json',async()=>{
    if(++count===1)throw Error('temporary network failure');return Response.json({ok:true});
  }),{ok:true});
  assert.equal(count,2);
  await assert.rejects(()=>readCityJSON('/city-data/v1/北京/latest.json',async()=>{throw Error('offline');}),(e:any)=>e.status===503);
});
test('static publication pins a data commit and copies latest/index files without huge historical snapshots or source files',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'busline-static-'));
  try{
    const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
    git('init');git('config','user.email','test@example.invalid');git('config','user.name','Test');
    mkdirSync(join(dir,'city-data/v1/北京/history'),{recursive:true});
    for(const name of ['latest','meta','history'])writeFileSync(join(dir,`city-data/v1/北京/${name}.json`),JSON.stringify({name,city:'北京市'}));
    writeFileSync(join(dir,'city-data/v1/北京/history/old.json'),'{}');
    writeFileSync(join(dir,'private-source.txt'),'must not be published');git('add','.');git('commit','-m','test');
    const output=join(dir,'out');const result=await mirrorCitySnapshots('HEAD',output,dir);
    assert.equal(result.cities,1);assert.ok(result.bytes>0);
    assert.equal(JSON.parse(readFileSync(join(output,'city-data/v1/北京/latest.json'),'utf8')).city,'北京市');
    assert.equal(existsSync(join(output,'private-source.txt')),false);
    assert.equal(existsSync(join(output,'city-data/v1/北京/history/old.json')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test('static latest and indexed history resolve compressed parts without any gateway, preserving full coordinates',async()=>{
  const {cityStorageFiles}=await import('../scripts/city-storage-files');
  const {normalizeCityDataset}=await import('../src/utils/cityDataset');
  const dir=mkdtempSync(join(tmpdir(),'busline-static-history-'));
  try{
    const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
    git('init');git('config','user.email','test@example.invalid');git('config','user.name','Test');
    const prefix='city-data/v1/北京',id='2026-11-16T00-00-00-000Z-abcdef123456';
    const data=normalizeCityDataset({schemaVersion:1,city:'北京市',scope:'city',coverage:'observed',filtered:false,retrievalComplete:true,capturedAt:'2026-11-16T00:00:00.000Z',
      stops:[{id:'s',name:'车站',location:[116.123456789,39.987654321]}],
      lines:Array.from({length:6},(_,r)=>({id:'l'+r,name:r+'路',path:Array.from({length:50000},(_,i)=>[116+Math.sin(i+r)*.01,39+Math.cos(i+r)*.01])}))});
    const archive=JSON.stringify(data);assert.ok(Buffer.byteLength(archive)>8*1024*1024);
    mkdirSync(join(dir,prefix,'history'),{recursive:true});
    writeFileSync(join(dir,prefix,'latest.json'),archive);
    writeFileSync(join(dir,prefix,'meta.json'),JSON.stringify({snapshotId:id}));
    writeFileSync(join(dir,prefix,'history.json'),JSON.stringify([{id}]));
    writeFileSync(join(dir,prefix,'history',id+'.json'),archive);
    git('add','.');git('commit','-m','legacy history');
    const out=join(dir,'out'),result=await mirrorCitySnapshots('HEAD',out,dir);
    assert.equal(result.historySnapshots,1);
    assert.ok(result.bytes<Buffer.byteLength(archive));
    const calls:string[]=[];
    const transport:typeof fetch=async input=>{
      const url=String(input);calls.push(url);assert.ok(url.startsWith('/city-data/'));
      return Response.json(JSON.parse(readFileSync(join(out,decodeURIComponent(url.split('?')[0])),'utf8')));
    };
    assert.deepEqual(normalizeCityDataset(await readCityJSON(sharedCityStaticURL('北京'),transport)),data);
    assert.deepEqual(normalizeCityDataset(await readCityJSON(sharedCityStaticURL('北京','history/'+id),transport)),data);
    assert.ok(calls.some(path=>path.includes('/parts/')));
    // Original files in the data branch are unchanged by static repacking.
    assert.equal(readFileSync(join(dir,prefix,'latest.json'),'utf8'),archive);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
