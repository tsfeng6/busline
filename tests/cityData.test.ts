import assert from 'node:assert/strict';
import test from 'node:test';
import { previewableCityDataset, normalizeCityDataset, cityDataKey, cityDatasetExpiresAt, usableCityDataset } from '../src/utils/cityDataset';
import { GithubCityStore, handleCityDataRequest, mapLimit } from '../src/server/cityData';

function fixture(count = 10, complete = true) {
  return { schemaVersion: 1, city: '北京市', scope: 'city', coverage: 'observed',
    capturedAt: new Date().toISOString(), retrievalComplete: complete, filtered: false,
    apiKey: 'must-not-survive', password: 'must-not-survive',
    stops: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `站点${i}`, address: `${i}路`, location: { lng: 116 + i * .001, lat: 39 } })),
    lines: Array.from({ length: count }, (_, i) => ({ id: `l${i}`, name: `${i}路(甲--乙)`, city: '北京市',
      path: [[116 + i * .001, 39], [116.1 + i * .001, 39.1]], via_stops: [], sourceQueries: [`${i}路`], apiKey: 'must-not-survive' })),
  };
}
function githubMock() {
  let counter = 0, head = 'initial', branchExists = false, conflict = false, failBlob = false;
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>([['initial-tree', new Map()]]);
  const commits = new Map<string, any>([['initial', { tree: { sha: 'initial-tree' } }]]);
  const writes: any[] = [];
  const response = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const pathname = decodeURIComponent(url.pathname.replace('/repos/tsfeng6/busline', ''));
    const method = options?.method || 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (method !== 'GET') writes.push({ pathname, body });
    if (pathname === '') return response({ default_branch: 'main' });
    if (pathname === '/git/ref/heads/main') return response({ object: { sha: 'initial' } });
    if (pathname === '/git/ref/heads/busline-data') return branchExists ? response({ object: { sha: head } }) : response({}, 404);
    if (pathname === '/git/refs') { branchExists = true; return response({}); }
    if (pathname.startsWith('/git/commits/') && method === 'GET') return response(commits.get(pathname.split('/').at(-1)!));
    if (pathname.startsWith('/contents/')) {
      const ref = url.searchParams.get('ref')!;
      const commit = commits.get(ref === 'busline-data' ? head : ref);
      const text = trees.get(commit?.tree.sha)?.get(pathname.slice('/contents/'.length));
      return text ? new Response(pathname.endsWith('.bvpk') ? Buffer.from(text, 'base64') : text, { status: 200 }) : response({}, 404);
    }
    if (pathname === '/git/blobs') {
      if (failBlob && body.encoding === 'base64') { failBlob = false; return response({}, 503); }
      const sha = `blob-${++counter}`;
      blobs.set(sha, body.content);
      return response({ sha });
    }
    if (pathname === '/git/trees') {
      const sha = `tree-${++counter}`, tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) { if (entry.sha === null) tree.delete(entry.path); else tree.set(entry.path, blobs.get(entry.sha)!); }
      trees.set(sha, tree); return response({ sha });
    }
    if (pathname === '/git/commits') {
      const sha = `commit-${++counter}`;
      commits.set(sha, { tree: { sha: body.tree }, parents: body.parents }); return response({ sha });
    }
    if (pathname === '/git/refs/heads/busline-data') {
      assert.equal(body.force, false);
      if (conflict) {
        conflict = false;
        commits.set('concurrent', commits.get(head)); head = 'concurrent';
        return response({}, 422);
      }
      assert.equal(commits.get(body.sha).parents[0], head);
      head = body.sha; return response({});
    }
    throw new Error(`Unexpected ${method} ${pathname}`);
  };
  const store = new GithubCityStore({ repo: 'tsfeng6/busline', branch: 'busline-data', token: 'fake-test-token', enabled: true }, transport);
  return { store, writes, transport, conflict: () => { conflict = true; }, failNextPackage: () => { failBlob = true; }, files: () => trees.get(commits.get(head).tree.sha)! };
}

test('mapLimit preserves order and bounds concurrency', async () => {
  let active = 0, peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return n * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.ok(peak <= 3);
  assert.deepEqual(await mapLimit([], 2, async () => 1), []);
});

test('snapshot validation strips credentials and preserves transport metadata', () => {
  const data = normalizeCityDataset(fixture());
  assert.ok(!JSON.stringify(data).includes('must-not-survive'));
  assert.deepEqual(data.lines[0].sourceQueries, ['0路']);
  assert.equal(cityDataKey('北京市'), cityDataKey('北京'));
  assert.throws(() => cityDataKey('../secret'));
  assert.throws(() => normalizeCityDataset({ ...fixture(), lines: [] }));
  assert.throws(() => normalizeCityDataset({ ...fixture(), lines: [{ ...fixture().lines[0], city: '上海市' }] }));
});

test('publishes latest/history atomically, reads history and deduplicates unchanged content', async () => {
  const mock = githubMock();
  const initial = fixture();
  const saved = await mock.store.publish(initial);
  assert.equal(saved.promoted, true);
  const files = mock.files();
  assert.ok(files.has('city-data/v1/北京/latest.json'));
  assert.ok(files.has(`city-data/v1/北京/history/${saved.id}.json`));
  assert.equal((await mock.store.latest('北京市'))?.lines.length, 10);
  assert.equal((await mock.store.history('北京')).length, 1);
  assert.equal((await mock.store.historical('北京', saved.id!))?.lines.length, 10);
  const before = mock.writes.length;
  assert.equal((await mock.store.publish(initial)).unchanged, true);
  assert.equal(mock.writes.length, before);
  assert.ok(mock.writes.filter(write => write.pathname === '/git/trees').every(write => write.body.tree.length === 5));
});

test('newest valid upload becomes default even when partial or smaller; delayed old uploads stay historical', async () => {
  const mock = githubMock(), now = Date.now();
  await mock.store.publish({...fixture(20),capturedAt:new Date(now-3000).toISOString()});
  assert.equal((await mock.store.publish({...fixture(20,false),capturedAt:new Date(now-2000).toISOString()})).promoted,true);
  assert.equal((await mock.store.latest('北京'))?.retrievalComplete,false);
  assert.equal((await mock.store.publish({...fixture(5),capturedAt:new Date(now-1000).toISOString()})).promoted,true);
  assert.equal((await mock.store.publish({...fixture(12),capturedAt:new Date(now-2500).toISOString()})).promoted,false);
  assert.equal((await mock.store.latest('北京市'))?.lines.length,5);
  assert.equal((await mock.store.history('北京市')).length,4);
  await assert.rejects(()=>mock.store.publish({...fixture(),filtered:true}),/过滤/);
});

test('the recent index stays bounded while all archived snapshots remain readable',async()=>{
  const mock=githubMock(),now=Date.now();const ids:string[]=[];
  for(let i=0;i<8;i++){
    const saved=await mock.store.publish({...fixture(i+1),capturedAt:new Date(now-10000+i*1000).toISOString()});
    ids.push(saved.id!);
  }
  const history=await mock.store.history('北京');
  assert.deepEqual(history.map(item=>item.id),ids.slice(-5).reverse());
  assert.equal((await mock.store.latest('北京'))?.lines.length,8);
  for (const id of ids) assert.ok(await mock.store.historical('北京', id));
  assert.equal([...mock.files().keys()].filter(path => path.includes('/history/')).length, 8);
  assert.ok(mock.writes.filter(write => write.pathname === '/git/trees').every(write => write.body.tree.every((entry: any) => entry.sha !== null)));
});

test('retries optimistic ref conflicts and retains one consistent snapshot', async () => {
  const mock = githubMock(); mock.conflict();
  assert.equal((await mock.store.publish(fixture())).promoted, true);
  assert.equal((await mock.store.history('北京市')).length, 1);
  assert.equal(mock.writes.filter(write => write.pathname === '/git/refs/heads/busline-data').length, 2);
});

test('unconfigured routes fail closed without contacting GitHub', async () => {
  const old = process.env.CITY_DATA_ENABLED;
  process.env.CITY_DATA_ENABLED = 'false';
  try { assert.equal((await handleCityDataRequest('POST', '/api/city-data/北京', fixture(), 'buslineadmin')).status, 503); }
  finally { if (old === undefined) delete process.env.CITY_DATA_ENABLED; else process.env.CITY_DATA_ENABLED = old; }
});

test('HTTP handler rejects default/wrong credentials and mismatched cities', async () => {
  const names = ['CITY_DATA_ENABLED', 'CITY_DATA_GITHUB_TOKEN', 'CITY_DATA_GITHUB_REPO', 'CITY_DATA_GITHUB_BRANCH', 'ADMIN_PASSWORD'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.CITY_DATA_ENABLED = 'true';
    process.env.CITY_DATA_GITHUB_TOKEN = 'fake-test-token';
    process.env.CITY_DATA_GITHUB_REPO = 'tsfeng6/busline';
    process.env.CITY_DATA_GITHUB_BRANCH = 'busline-data';
    process.env.ADMIN_PASSWORD = 'buslineadmin';
    assert.equal((await handleCityDataRequest('POST', '/api/city-data/北京市', fixture(), 'buslineadmin')).status, 401);
    process.env.ADMIN_PASSWORD = 'test-admin-password-12345';
    assert.equal((await handleCityDataRequest('POST', '/api/city-data/北京市', fixture(), 'wrong')).status, 401);
    assert.equal((await handleCityDataRequest('POST', '/api/city-data/上海市', fixture(), process.env.ADMIN_PASSWORD)).status, 400);
  } finally {
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
});

test('renewing an expired unchanged city updates verification time instead of causing endless live refreshes', async () => {
  const mock = githubMock();
  await mock.store.publish(fixture());
  const previous = JSON.parse(mock.files().get('city-data/v1/北京/latest.json')!);
  previous.header.capturedAt = new Date(Date.now() - 90 * 86400000).toISOString();
  mock.files().set('city-data/v1/北京/latest.json', JSON.stringify(previous));
  const next = { ...fixture(), capturedAt: new Date(Date.now() + 1000).toISOString() };
  assert.equal((await mock.store.publish(next)).promoted, true);
  assert.equal((await mock.store.latest('北京'))?.capturedAt, next.capturedAt);
});

test('two calendar months handles month ends and rejects future/incomplete data', () => {
  assert.equal(new Date(cityDatasetExpiresAt({capturedAt:'2024-12-31T10:00:00.000Z'})).toISOString(),'2025-02-28T10:00:00.000Z');
  assert.equal(new Date(cityDatasetExpiresAt({capturedAt:'2023-12-31T10:00:00.000Z'})).toISOString(),'2024-02-29T10:00:00.000Z');
  assert.equal(new Date(cityDatasetExpiresAt({capturedAt:'2024-12-30T16:30:00.000Z'})).toISOString(),'2025-02-27T16:30:00.000Z');
  const data=normalizeCityDataset({...fixture(),capturedAt:'2026-08-15T10:00:00.000Z'});
  assert.equal(usableCityDataset(data,Date.parse('2026-10-14T10:00:00Z')),true);
  assert.equal(usableCityDataset(data,Date.parse('2026-10-15T10:00:00Z')),false);
  assert.equal(usableCityDataset({...data,retrievalComplete:false},Date.parse('2026-10-14T10:00:00Z')),false);
});

test('ordinary visitors can obtain a city-scoped lease and publish without administrator credentials', async () => {
  const names=['CITY_DATA_ENABLED','CITY_DATA_GITHUB_TOKEN','CITY_DATA_GITHUB_REPO','CITY_DATA_GITHUB_BRANCH','ADMIN_PASSWORD'];
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const previousFetch=globalThis.fetch;
  const mock=githubMock();
  try {
    globalThis.fetch=mock.transport;
    Object.assign(process.env,{CITY_DATA_ENABLED:'true',CITY_DATA_GITHUB_TOKEN:'fake-test-token',CITY_DATA_GITHUB_REPO:'tsfeng6/busline',CITY_DATA_GITHUB_BRANCH:'busline-data'});
    delete process.env.ADMIN_PASSWORD;
    const lease=await handleCityDataRequest('POST','/api/city-data/北京市/refresh',{});
    assert.equal(lease.status,200);
    assert.equal(lease.body.token.length,64);
    assert.equal((await handleCityDataRequest('POST','/api/city-data/北京市/refresh',{})).status,409);
    assert.equal((await handleCityDataRequest('POST','/api/city-data/上海市',fixture(),' ',lease.body.token)).status,401);
    assert.equal((await handleCityDataRequest('POST','/api/city-data/北京市',fixture(),'','x'.repeat(64))).status,401);
    const result=await handleCityDataRequest('POST','/api/city-data/北京市',fixture(),'',lease.body.token);
    assert.equal(result.status,200); assert.equal(result.body.promoted,true);
    assert.equal((await handleCityDataRequest('POST','/api/city-data/北京市',fixture(),'',lease.body.token)).status,401);
    assert.equal((await handleCityDataRequest('POST','/api/city-data/北京市/refresh',{})).status,409);
    const other=await handleCityDataRequest('POST','/api/city-data/上海市/refresh',{});
    assert.equal(other.status,200);
    assert.equal((await handleCityDataRequest('DELETE','/api/city-data/上海市/refresh',undefined,'',other.body.token)).status,200);
  } finally {
    globalThis.fetch=previousFetch;
    for (const name of names) { if(saved[name]===undefined) delete process.env[name]; else process.env[name]=saved[name]; }
  }
});


test('partial snapshots can be previewed without being marked complete, but expired and filtered ones cannot', () => {
  const data:any={capturedAt:new Date().toISOString(),retrievalComplete:false,filtered:false,lines:[{}],stops:[{}]};
  assert.equal(previewableCityDataset(data),true);
  assert.equal(usableCityDataset(data),false);
  assert.equal(previewableCityDataset({...data,filtered:true}),false);
  assert.equal(previewableCityDataset({...data,capturedAt:'2020-01-01T00:00:00Z'}),false);
});

test('large city snapshots use lossless compressed files shared by latest and history', async () => {
  const { cityStorageFiles } = await import('../scripts/city-storage-files');
  const { resolveCityParts, isCityParts } = await import('../src/utils/cityStorage');
  const data = normalizeCityDataset(fixture(40));
  data.lines[0].path[0] = [116.123456789123, 39.987654321098];
  const id = '2026-11-16T00-00-00-000Z-abcdef123456', prefix = 'city-data/v1/北京';
  const files = new Map([...cityStorageFiles(data, prefix, id, true, 2048)].map(file => [file.path, JSON.parse(file.content)]));
  const manifest = files.get(`${prefix}/latest.json`);
  assert.ok(isCityParts(manifest));
  assert.deepEqual(manifest, files.get(`${prefix}/history/${id}.json`));
  assert.ok(manifest.parts.length > 1);
  assert.ok(manifest.parts.every((part:string) => files.get(`${prefix}/${part}`).encoding === 'gzip-base64'));
  const restored = normalizeCityDataset(await resolveCityParts(manifest, async part => files.get(`${prefix}/${part}`)));
  assert.deepEqual(restored, data);
  assert.equal(restored.lines[0].path[0][0], 116.123456789123);
  await assert.rejects(resolveCityParts({...manifest,parts:['../secret']},async()=>({})),/路径/);
});

test('GitHub publication and subsequent reads round-trip a real snapshot larger than 8MiB', async () => {
  const input=fixture(6);
  for(let r=0;r<input.lines.length;r++)input.lines[r].path=Array.from({length:50000},(_,i)=>[116+Math.sin(i+r)*.01,39+Math.cos(i+r)*.01]);
  const data=normalizeCityDataset(input),mock=githubMock();
  assert.ok(Buffer.byteLength(JSON.stringify(data))>8*1024*1024);
  const result=await mock.store.publish(data);
  assert.equal(result.promoted,true);
  const manifest=JSON.parse(mock.files().get('city-data/v1/北京/latest.json')!);
  assert.equal(manifest.storage,'city-bvpk1');
  assert.ok(manifest.parts.length>1);
  assert.deepEqual(await mock.store.latest('北京'),data);
  assert.deepEqual(await mock.store.historical('北京',result.id!),data);
  assert.equal((await mock.store.publish(data)).unchanged,true);
});

test('history audit leaves an older active snapshot, newer archives and all files unchanged',async()=>{
  const {mkdtemp,mkdir,writeFile,readFile,readdir,rm}=await import('node:fs/promises');
  const {join}=await import('node:path');const {tmpdir}=await import('node:os');
  const {cityStorageFiles}=await import('../scripts/city-storage-files');
  const {retainCityHistory}=await import('../scripts/retain-city-history');
  const root=await mkdtemp(join(tmpdir(),'busline-retain-')),prefix='city-data/v1/北京';
  try{
    const records:any[]=[];
    for(let i=0;i<8;i++){
      const data=normalizeCityDataset({...fixture(9-i),capturedAt:new Date(Date.now()-10000+i*1000).toISOString()});
      const id=`${data.capturedAt.replace(/[:.]/g,'-')}-${String(i).padStart(12,'0')}`;
      for(const file of cityStorageFiles(data,prefix,id,i===0,500)){
        await mkdir(join(root,file.path,'..'),{recursive:true});await writeFile(join(root,file.path),file.content);
      }
      records.unshift({id,capturedAt:data.capturedAt,promoted:i===0});
    }
    await writeFile(join(root,prefix,'history.json'),JSON.stringify(records.reverse()));
    await writeFile(join(root,prefix,'meta.json'),JSON.stringify({snapshotId:records[0].id}));
    const before = new Map<string, Buffer>();
    for (const file of await readdir(join(root, prefix), { recursive: true, withFileTypes: true })) {
      if (file.isFile()) {
        const path = join(file.parentPath, file.name);
        before.set(path, await readFile(path));
      }
    }
    assert.deepEqual(await retainCityHistory(root), { cities: 1, snapshots: 8 });
    for (const [path, bytes] of before) assert.deepEqual(await readFile(path), bytes);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('an unavailable active package stops a publish and leaves current and archives alone', async () => {
  const mock = githubMock(), input = fixture();
  await mock.store.publish(input);
  const files = mock.files();
  const pack = [...files.keys()].find(path => path.includes('/bvpk/'))!;
  files.set(pack, Buffer.from('invalid BVPK1').toString('base64'));
  const before = [...files];
  const writes = mock.writes.length;
  await assert.rejects(mock.store.publish({ ...input, capturedAt: new Date(Date.now() + 1000).toISOString() }), /校验/);
  assert.equal(mock.writes.length, writes);
  assert.deepEqual([...mock.files()], before);
});

test('failed package write keeps the prior release and can be retried atomically', async () => {
  const mock = githubMock();
  const now = Date.now();
  const previous = { ...fixture(), capturedAt: new Date(now - 1000).toISOString() };
  const update = { ...fixture(2), capturedAt: new Date(now).toISOString() };
  const first = await mock.store.publish(previous);
  const before = [...mock.files()];
  mock.failNextPackage();
  await assert.rejects(mock.store.publish(update), (error: any) => error.status === 503);
  assert.deepEqual([...mock.files()], before);
  assert.deepEqual(await mock.store.latest('北京'), normalizeCityDataset(previous));
  assert.equal((await mock.store.publish(update)).promoted, true);
  assert.deepEqual(await mock.store.latest('北京'), normalizeCityDataset(update));
  assert.deepEqual(await mock.store.historical('北京', first.id!), normalizeCityDataset(previous));
});
