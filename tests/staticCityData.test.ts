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
test('a bounded mobile read retries and reports a network failure instead of waiting indefinitely', async () => {
  let attempts = 0;
  const stalled: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    attempts++;
    init?.signal?.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(() => readCityJSON('/city-data/v1/北京/latest.json', stalled, { timeoutMs: 5 }), (error: any) => error.status === 503);
  assert.equal(attempts, 2);
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


test('production Vite relative base loads latest, history and parts instead of being rejected',async()=>{
  const config=readFileSync('vite.config.ts','utf8');
  const match=/\bbase:\s*['"]([^'"]*)['"]/.exec(config);assert.ok(match);
  const base=match[1],id='2026-11-16T00-00-00-000Z-abcdef123456';
  const expected=base==='./'?'./city-data/':base.replace(/\/$/,'')+'/city-data/';
  const calls:string[]=[];
  for(const suffix of ['', 'history/'+id]){
    const url=sharedCityStaticURL('廊坊市',suffix,'',base);
    assert.ok(url.startsWith(expected));
    const data=await readCityJSON(url,async input=>{
      const path=String(input);calls.push(path);assert.ok(path.startsWith(expected));
      return Response.json(path.includes('/parts/')?{lines:[{name:'1路'}],stops:[{name:'车站'}]}:
        {storage:'city-parts-v1',header:{city:'廊坊市'},parts:['parts/'+id+'/0.json']});
    });
    assert.equal(data.city,'廊坊市');assert.equal(data.lines.length,1);assert.equal(data.stops.length,1);
  }
  assert.equal(calls.length,4);
  for(const invalid of ['//worker.example/data','https://worker.example/data','http://worker.example/data']){
    await assert.rejects(readCityJSON(invalid,async()=>{throw Error('Unexpected fetch');}),/同源/);
  }
});

test('static mixed-format publication serves validated BVPK1, keeps legacy history read-only and retries corrupted cache', async () => {
  const { packCitySnapshot } = await import('../scripts/city-bvpk-files');
  const { normalizeCityDataset } = await import('../src/utils/cityDataset');
  const { brotliDecompressSync } = await import('node:zlib');
  const dir = mkdtempSync(join(tmpdir(), 'busline-static-bvpk-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
    const prefix = 'city-data/v1/北京';
    const id = '2026-11-16T00-00-00-000Z-abcdef123456', oldId = '2026-11-15T00-00-00-000Z-bcdef1234567';
    const data = normalizeCityDataset({
      schemaVersion: 1, city: '北京市', scope: 'city', coverage: 'observed', filtered: false, retrievalComplete: true,
      capturedAt: '2026-11-16T00:00:00.000Z',
      stops: [{ id: '2', name: '乙站', location: [116.101, 39.912345678] }, { id: '1', name: '甲站', location: [116.100001, 39.9] }],
      lines: [
        { id: '9', name: '9路', path: [[116.101, 39.9], [116.100001, 39.901], [116.100001, 39.901]], stime: '06:20', etime: '23:59' },
        { id: '1', name: '1路', path: [[116.101000000092, 39.9], [116.101, 39.901]], via_stops: [{ id: '1', name: '甲站', location: [116.101, 39.9] }] },
      ],
    });
    assert.deepEqual(data.lines.map(line => line.id), ['9', '1']);
    assert.deepEqual(data.stops.map(stop => stop.id), ['2', '1']);
    const { manifest, files } = await packCitySnapshot(data, prefix, id, 350);
    assert.ok(manifest.parts.length > 1);
    function put(path: string, content: string | Buffer) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    const old = { ...data, capturedAt: '2026-11-15T00:00:00.000Z' };
    put(prefix + '/latest.json', JSON.stringify(manifest));
    put(prefix + '/meta.json', JSON.stringify({ snapshotId: id }));
    put(prefix + '/history.json', JSON.stringify([{ id }, { id: oldId }]));
    put(prefix + '/history/' + id + '.json', JSON.stringify(manifest));
    put(prefix + '/history/' + oldId + '.json', JSON.stringify(old));
    for (const file of files) put(file.path, file.content);
    git('add', '.'); git('commit', '-m', 'mixed city formats');

    const out = join(dir, 'out');
    const result = await mirrorCitySnapshots('HEAD', out, dir);
    assert.equal(result.historySnapshots, 2);
    const calls: Array<{ path: string; cache?: string }> = [];
    let corruptOnce = true, fail = false;
    const transport: typeof fetch = async (input, options) => {
      const path = decodeURIComponent(String(input).split('?')[0]);
      calls.push({ path, cache: options?.cache });
      const bytes = readFileSync(join(out, path));
      if (path.includes('/bvpk/')) {
        if (fail) return new Response(null, { status: 404 });
        if (corruptOnce) { corruptOnce = false; bytes[bytes.length - 1] ^= 1; }
      }
      return new Response(bytes);
    };
    const options = { decompress: brotliDecompressSync, expectedSnapshotId: id };
    const cityUrl = sharedCityStaticURL('北京', '', id);
    assert.deepEqual(normalizeCityDataset(await readCityJSON(cityUrl, transport, options)), data);
    assert.deepEqual(calls.slice(0, 3).map(call => call.cache), ['no-cache', 'force-cache', 'reload']);
    assert.deepEqual(normalizeCityDataset(await readCityJSON(sharedCityStaticURL('北京', 'history/' + oldId), transport)), old);
    await assert.rejects(readCityJSON(cityUrl, transport, { ...options, expectedSnapshotId: oldId }), /同步/);
    fail = true;
    calls.length = 0;
    await assert.rejects(readCityJSON(cityUrl, transport, options), (error: any) => error.status === 503);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => !call.path.includes('/history')));

    put(files[0].path, Buffer.from('corrupt'));
    git('add', files[0].path); git('commit', '-m', 'corrupt data');
    const bad = join(dir, 'bad');
    await assert.rejects(mirrorCitySnapshots('HEAD', bad, dir), /校验/);
    assert.equal(existsSync(join(bad, 'city-data/v1/publication.json')), false);

    // Explicit operator rollback selects the old version and removes the corrupt entry from the public index only.
    put(prefix + '/latest.json', JSON.stringify(old));
    put(prefix + '/meta.json', JSON.stringify({ snapshotId: oldId }));
    put(prefix + '/history.json', JSON.stringify([{ id: oldId }]));
    git('add', ...['latest.json', 'meta.json', 'history.json'].map(path => prefix + '/' + path));
    git('commit', '-m', 'manual city rollback');
    const rollback = join(dir, 'rollback');
    await mirrorCitySnapshots('HEAD', rollback, dir);
    assert.deepEqual(JSON.parse(readFileSync(join(rollback, prefix, 'latest.json'), 'utf8')), JSON.parse(JSON.stringify(old)));
    assert.equal(readFileSync(join(dir, files[0].path), 'utf8'), 'corrupt');
    assert.equal(readFileSync(join(dir, prefix, 'history', id + '.json'), 'utf8'), JSON.stringify(manifest));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
