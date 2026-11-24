import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { mirrorCitySnapshots } from '../scripts/publish-city-static';
import { tileRoutePaths } from '../scripts/transit-tiles';
import { packCitySnapshot } from '../scripts/city-bvpk-files';
import { cityStorageFiles } from '../scripts/city-storage-files';
import { normalizeCityDataset } from '../src/utils/cityDataset';
import { TransitTileCache } from '../src/utils/transitTileCache';
import { nearbyTileRoutes } from '../src/utils/nearbyTransitTiles';
import { isLineOperating } from '../src/utils/timeline';
import { decodeTransitTile } from '../src/utils/transitTileDecode';
import {
  tileKey, tileLngLat, tilesInBounds, tileAncestor, transitLevel, timelineTransitLevel, TIMELINE_TILE_ZOOM, transitTileSource, transitPackTile, transitPackLocation, transitTileIndexed, validTransitTileIndex,
  type TransitTileData,
} from '../src/utils/transitTiles';

test('a path crossing tiles retains matching clipped endpoints and full-resolution interior points', () => {
  const z = 15, x = 26950, y = 12430;
  const from = tileLngLat([x - .25, y + .5], z);
  const middle = tileLngLat([x + .25, y + .52], z);
  const to = tileLngLat([x + 2.25, y + .5], z);
  const paths = tileRoutePaths([from, middle, to], z);
  assert.equal(paths.size, 4);
  const west = paths.get(tileKey({ z, x: x - 1, y }))![0];
  const east = paths.get(tileKey({ z, x, y }))![0];
  assert.equal(west.at(-2), 4096);
  assert.equal(east[0], 0);
  assert.equal(west.at(-1), east[1]);
  assert.deepEqual(east.slice(2, 4), [1024, 2130]);
  assert.ok(paths.has(tileKey({ z, x: x + 1, y })));
});

test('viewport levels and exact child readiness preserve the coarse parent during pan and zoom', () => {
  assert.deepEqual([3, 12, 12.99, 13, 14.8, 15, 20].map(transitLevel), [null, null, null, 13, 13, 15, 15]);
  assert.deepEqual([7, 9, 11.5, 13, 15].map(zoom => timelineTransitLevel(zoom, true)), [null, 10, 10, 13, 15]);
  assert.equal(timelineTransitLevel(11.5, false), null);
  const child = { z: 15, x: 26950, y: 12430 };
  const parent = tileAncestor(child, 13);
  const index = new Set([tileKey(parent), tileKey(child)]), loaded = new Set([tileKey(parent)]);
  assert.deepEqual(transitTileSource(child, tile => index.has(tileKey(tile)), key => loaded.has(key)), parent);
  const overview = tileAncestor(child, TIMELINE_TILE_ZOOM);
  const onlyOverview = (key: string) => key === tileKey(overview);
  assert.deepEqual(transitTileSource(child, () => true, onlyOverview, true), overview);
  assert.equal(transitTileSource(child, () => true, onlyOverview), null);
  loaded.add(tileKey(child));
  assert.deepEqual(transitTileSource(child, tile => index.has(tileKey(tile)), key => loaded.has(key)), child);
  assert.equal(transitTileSource({ ...child, x: child.x + 1 }, tile => index.has(tileKey(tile)), key => loaded.has(key)), null);
  const [west, north] = tileLngLat([child.x + .1, child.y + .1], child.z);
  const [east, south] = tileLngLat([child.x + .9, child.y + .9], child.z);
  assert.deepEqual(tilesInBounds([west, south, east, north], 15, 1)[0], child);
  assert.equal(tilesInBounds([west, south, east, north], 15, 1).length, 9);
});

test('single publication merges Beijing, Baoding and Langfang from BVPK1, legacy JSON and gzip parts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'busline-transit-test-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
    const put = (path: string, content: string | Buffer) => {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    };
    git('init');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    const id = '2026-11-22T00-00-00-000Z-abcdef123456';
    const stop = [116.2, 39.5];
    const cities = ['北京', '保定', '廊坊'];
    for (const [i, name] of cities.entries()) {
      const prefix = 'city-data/v1/' + name;
      const data = normalizeCityDataset({
        schemaVersion: 1, scope: 'city', coverage: 'observed', city: name + '市', capturedAt: '2026-11-22T00:00:00Z',
        filtered: false, retrievalComplete: true,
        stops: [{ id: 's', name: '边界站', address: '1路', location: stop }],
        lines: [{ id: 'route', name: '1路', stime: '05:30', etime: '22:00', path: [[116.17, 39.5], [116.23, 39.5]], via_stops: [{ name: '边界站', location: stop }] }],
      });
      put(prefix + '/meta.json', JSON.stringify({ snapshotId: id }));
      if (i === 0) {
        const { files, manifest } = await packCitySnapshot(data, prefix, id);
        for (const file of files) put(file.path, file.content);
        put(prefix + '/latest.json', JSON.stringify(manifest));
      } else if (i === 1) {
        put(prefix + '/latest.json', JSON.stringify(data));
      } else {
        for (const file of cityStorageFiles(data, prefix, id, true, 450)) put(file.path, file.content);
      }
    }
    git('add', '.');
    git('commit', '-m', 'mixed fixtures');
    const out = join(root, 'out'), layers = join(root, 'layers'), publicationCache = join(root, 'publication-cache');
    const result = await mirrorCitySnapshots('HEAD', out, root, layers, publicationCache);
    assert.equal(result.cities, 3);
    const repeated = await mirrorCitySnapshots('HEAD', out, root, layers, publicationCache);
    assert.equal(repeated.reused, 3, 'unchanged cities reuse both contribution and overview caches');
    const index = JSON.parse(readFileSync(join(out, 'city-data/v1/transit.json'), 'utf8'));
    assert.ok(validTransitTileIndex(index));
    assert.equal(index.revision, git('rev-parse', 'HEAD'));
    assert.deepEqual(index.timelineCities.map(city => city.hours), cities.map(() => [['05:30', '22:00', 1]]));
    for (const z of [TIMELINE_TILE_ZOOM, 13, 15]) {
      const [tile] = tilesInBounds([stop[0], stop[1], stop[0], stop[1]], z);
      const group = transitPackLocation(tile);
      assert.ok(transitTileIndexed(index)(tile));
      const pack = readFileSync(join(out, 'city-data/v1', index.base, group.key + '-' + index.groups[group.key][1] + '.pack'));
      const tileBytes = transitPackTile(pack, group.slot, group.slots);
      const stream = new Blob([new Uint8Array(tileBytes)]).stream();
      const decoded = await decodeTransitTile(stream.pipeThrough(new DecompressionStream('gzip')), new AbortController().signal);
      assert.ok(gunzipSync(tileBytes).byteLength > 0);
      assert.deepEqual(decoded.routes.map(route => route.city).sort(), cities.map(name => name + '市').sort());
      assert.ok(decoded.routes.every(route => route.stime === '05:30' && route.etime === '22:00'));
      assert.equal(decoded.stops.length, z === TIMELINE_TILE_ZOOM ? 0 : 3);
      assert.ok(decoded.routes.every(route => isLineOperating(route, 720) && isLineOperating(route, 0) === false));
      assert.ok(decoded.stops.every(stop => stop.terminal && stop.lines.includes('1路')));
      assert.deepEqual(nearbyTileRoutes([{ tile, data: decoded }], [116.2, 39.5]).map(route => route.city).sort(), cities.map(name => name + '市').sort());
    }
    // Change only Baoding.  Its border tile must be rebuilt from all three
    // city contributions instead of replacing Beijing and Langfang records.
    const baodingPath = join(root, 'city-data/v1/保定/latest.json');
    const baoding = JSON.parse(readFileSync(baodingPath, 'utf8'));
    baoding.lines[0].name = '2路';
    writeFileSync(baodingPath, JSON.stringify(baoding));
    git('add', '.'); git('commit', '-m', 'update baoding');
    const incremental = await mirrorCitySnapshots('HEAD', out, root, layers, publicationCache);
    assert.equal(incremental.reused, 2);
    const nextIndex = JSON.parse(readFileSync(join(out, 'city-data/v1/transit.json'), 'utf8'));
    const [tile] = tilesInBounds([stop[0], stop[1], stop[0], stop[1]], 13);
    const group = transitPackLocation(tile);
    const pack = readFileSync(join(out, 'city-data/v1', nextIndex.base, group.key + '-' + nextIndex.groups[group.key][1] + '.pack'));
    const bytes = transitPackTile(pack, group.slot, group.slots);
    const decoded = await decodeTransitTile(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')), new AbortController().signal);
    assert.deepEqual(decoded.routes.map(route => route.city).sort(), cities.map(name => name + '市').sort());
    assert.ok(decoded.routes.some(route => route.city === '保定市' && route.name === '2路'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stream decoder handles UTF-8 record boundaries and refuses truncated or canceled tiles', async () => {
  const bytes = new TextEncoder().encode('[0,"北京市","id","1路",[[0,0,4096,4096]]]\n');
  const stream = (value: Uint8Array) => new ReadableStream<Uint8Array>({
    start(controller) { for (const byte of value) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
  });
  const controller = new AbortController();
  const result = await decodeTransitTile(stream(bytes), controller.signal);
  assert.equal(result.routes[0].city, '北京市');
  assert.ok(result.routes[0].paths[0] instanceof Float32Array);
  await assert.rejects(decodeTransitTile(stream(bytes.subarray(0, -1)), controller.signal), /Truncated/);
  controller.abort();
  await assert.rejects(decodeTransitTile(stream(bytes), controller.signal), { name: 'AbortError' });
});

test('stream decoder keeps compact route operating hours and accepts pre-existing tiles', async () => {
  const stream = (record: string) => new Blob([record]).stream();
  const fresh = await decodeTransitTile(stream('[0,"北京市","id","1路","05:30","22:00",[[0,0,4096,4096]]]\n'), new AbortController().signal);
  assert.deepEqual({ stime: fresh.routes[0].stime, etime: fresh.routes[0].etime }, { stime: '05:30', etime: '22:00' });
  const legacy = await decodeTransitTile(stream('[0,"北京市","id","1路",[[0,0,4096,4096]]]\n'), new AbortController().signal);
  assert.equal(legacy.routes[0].stime, undefined);
  assert.equal(legacy.routes[0].etime, undefined);
});

test('viewport cache bounds decoded memory, cancels irrelevant work and defers prefetch until idle', async () => {
  const requests: { key: string; signal: AbortSignal; done: (tile: TransitTileData) => void }[] = [];
  const data = (bytes: number): TransitTileData => ({ bytes, routes: [], stops: [] });
  let now = 0;
  const nextTick = () => new Promise(resolve => setImmediate(resolve));
  const cache = new TransitTileCache((key, signal) =>
    new Promise(done => requests.push({ key, signal, done })), () => {}, 10, 2, () => now);
  cache.update(['a', 'b'], ['neighbor']);
  cache.pause();
  cache.update(['b', 'c'], ['neighbor'], true);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false);
  assert.deepEqual(requests.map(request => request.key), ['a', 'b', 'c']);
  requests[0].done(data(9));
  requests[1].done(data(4));
  requests[2].done(data(4));
  await nextTick();
  assert.equal(cache.has('a'), false);
  assert.equal(cache.bytes, 8);
  assert.equal(requests.at(-1)!.key, 'neighbor');
  requests.at(-1)!.done(data(4));
  await nextTick();
  assert.equal(cache.has('neighbor'), false);
  assert.equal(cache.bytes, 8);
  cache.update(['c', 'd'], []);
  requests.at(-1)!.done(data(5));
  await nextTick();
  assert.equal(cache.has('b'), false);
  assert.equal(cache.bytes, 9);
  now = 11000;
  cache.update(['neighbor'], []);
  requests.at(-1)!.done(data(4));
  await nextTick();
  assert.equal(cache.has('neighbor'), true);
  assert.ok(cache.bytes <= 10);
  cache.dispose();
  assert.equal(cache.bytes, 0);
});
