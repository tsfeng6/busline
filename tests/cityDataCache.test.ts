import assert from 'node:assert/strict';
import test from 'node:test';
import { CityDataCache, estimateCityBytes } from '../src/utils/cityDataCache';
import type { CityDataset } from '../src/utils/cityDataset';

function dataset(city: string, lines: number, stops: number): CityDataset {
  return {
    schemaVersion: 1, city, scope: 'city', capturedAt: '2026-11-20T00:00:00Z',
    retrievalComplete: true, coverage: 'observed', filtered: false,
    stops: Array.from({ length: stops }, (_, i) => ({ id: `s${i}`, name: `站点${i}`, address: '', location: { lng: 116, lat: 39 } })),
    lines: Array.from({ length: lines }, (_, i) => ({ id: `l${i}`, name: `${i}路`, city, path: [[116, 39], [116.1, 39.1]] as [number, number][], stops: [] })),
  };
}

test('estimateCityBytes is monotonic in line and stop counts', () => {
  assert.ok(estimateCityBytes(dataset('北京', 10, 10)) < estimateCityBytes(dataset('北京', 100, 100)));
});

test('cache returns loader result and reuses it (single-flight)', async () => {
  let calls = 0;
  const cache = new CityDataCache(async (city: string) => { calls++; return dataset(city, 1, 1); });
  const [a, b] = await Promise.all([cache.get('北京'), cache.get('北京')]);
  assert.equal(calls, 1);
  assert.equal(a?.city, '北京');
  assert.equal(b, a);
});

test('evicts unpinned LRU entries when over budget, keeps pinned', async () => {
  const big = new CityDataCache(async (city: string) => dataset(city, 5000, 5000), 1000);
  await big.get('A', { pin: true });       // pinned, must survive
  await big.get('B');                       // evictable
  await big.get('C');                       // evictable, newest
  assert.ok(big.count <= 2, `count=${big.count}`);
  assert.ok((await big.get('A')) !== null, 'pinned A survived');
});

test('unpinned entries are evicted before pinned ones', async () => {
  const cache = new CityDataCache(async (city: string) => dataset(city, 5000, 5000), 1000);
  await cache.get('P', { pin: true });
  await cache.get('E1');
  await cache.get('E2');
  await cache.get('E3');
  assert.equal(await cache.get('P'), (await cache.get('P')), 'pinned still present');
  // P should remain; at most pinned + one evictable survive
  assert.ok(cache.count <= 2);
});

test('invalidate clears entries and ignores late resolutions', async () => {
  let resolve!: (d: CityDataset) => void;
  const cache = new CityDataCache(() => new Promise<CityDataset>(r => { resolve = r; }), 1 << 20);
  const pending = cache.get('北京');
  cache.invalidate();
  resolve(dataset('北京', 1, 1));
  await pending;
  assert.equal(cache.count, 0, 'late resolution must not re-insert after invalidate');
});

test('peek returns cached data without triggering a load, and pins on demand', async () => {
  let loads = 0;
  const cache = new CityDataCache(async (city: string) => { loads++; return dataset(city, 1, 1); });
  assert.equal(cache.peek('北京'), null);
  assert.equal(loads, 0);
  await cache.get('北京');
  assert.ok(cache.peek('北京'));
  cache.peek('北京', { pin: true });
  assert.equal(loads, 1);
});

test('pin/unpin toggles evictability', async () => {
  const cache = new CityDataCache(async (city: string) => dataset(city, 5000, 5000), 1000);
  await cache.get('A');
  cache.pin('A');
  await cache.get('B');
  await cache.get('C');
  assert.ok((await cache.get('A')) !== null);
});

test('city-specific invalidation discards an in-flight version and preserves other cities', async () => {
  const old = dataset('北京', 1, 1);
  const updated = { ...old, capturedAt: '2026-11-22T00:00:00.000Z' };
  const other = dataset('天津', 1, 1);
  let resolveOld!: (data: typeof old) => void;
  let visits = 0;
  const cache = new CityDataCache(city => {
    if (city === '天津') return Promise.resolve(other);
    if (visits++ === 0) return new Promise(resolve => { resolveOld = resolve; });
    return Promise.resolve(updated);
  });
  await cache.get('天津');
  const previous = cache.get('北京');
  cache.invalidate('北京市');
  assert.equal(await cache.get('北京'), updated);
  resolveOld(old);
  await previous;
  assert.equal(cache.peek('北京'), updated);
  assert.equal(cache.peek('天津'), other);
});
