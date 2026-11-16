import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mirrorCitySnapshots} from '../scripts/publish-city-static';
import {readCityJSON} from '../src/utils/sharedCityRead';

test('existing city data can load from website origin without reaching the Worker',async()=>{
  const calls:string[]=[];
  const data=await readCityJSON(['/city-data/v1/北京/latest.json','https://worker.example/api/city-data/北京'],async input=>{
    calls.push(String(input));assert.ok(String(input).startsWith('/city-data/'));return Response.json({city:'北京市'});
  });
  assert.deepEqual(data,{city:'北京市'});assert.equal(calls.length,1);
});
test('static miss falls back to the gateway and network errors remain distinct from missing data',async()=>{
  let count=0;
  assert.deepEqual(await readCityJSON(['/missing','https://gateway.example'],async()=>++count===1?new Response(null,{status:404}):Response.json({ok:true})),{ok:true});
  await assert.rejects(()=>readCityJSON(['/a','/b'],async()=>new Response(null,{status:404})),(e:any)=>e.status===404);
  await assert.rejects(()=>readCityJSON(['/a','/b'],async()=>{throw Error('offline');}),(e:any)=>e.status===503);
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
