import assert from 'node:assert/strict';
import test from 'node:test';
import { CityPrefetcher } from '../src/utils/cityPrefetcher';

function flush(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)); }

test('viewport dequeues before earlier-queued neighbor tasks', async () => {
  const order: string[] = [];
  const gates: (() => void)[] = [];
  const prefetcher = new CityPrefetcher((city) => new Promise<void>(resolve => {
    gates.push(() => { order.push(city); resolve(); });
  }), 1);
  prefetcher.enqueue(['A'], 'neighbor');      // inflight, gated
  prefetcher.enqueue(['B', 'C'], 'neighbor');
  prefetcher.enqueue(['B'], 'viewport');      // upgrade B above C
  await flush();
  gates.shift()!(); await flush();            // release A
  gates.shift()!(); await flush();            // release next dequeued (must be B)
  assert.equal(order[1], 'B');
  gates.shift()!(); await flush();            // release C
  assert.deepEqual(order, ['A', 'B', 'C']);
});

test('concurrency limit is respected and all tasks complete', async () => {
  let active = 0, peak = 0, done = 0;
  const prefetcher = new CityPrefetcher((city) => new Promise<void>(resolve => {
    active++; peak = Math.max(peak, active);
    setTimeout(() => { active--; done++; resolve(); }, 5);
  }), 2);
  prefetcher.enqueue(['A', 'B', 'C', 'D'], 'viewport');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(peak, 2);
  assert.equal(done, 4);
  assert.equal(prefetcher.activeCount, 0);
  assert.equal(prefetcher.pendingCount, 0);
});

test('cancel drops pending tasks but keeps inflight', async () => {
  const started: string[] = [];
  const gates: (() => void)[] = [];
  const prefetcher = new CityPrefetcher((city) => new Promise<void>(resolve => {
    started.push(city);
    gates.push(() => resolve());
  }), 1);
  prefetcher.enqueue(['A', 'B', 'C'], 'viewport');
  await flush();
  assert.deepEqual(started, ['A']);
  prefetcher.cancel();
  gates.shift()!();
  await flush();
  assert.equal(prefetcher.pendingCount, 0);
  assert.equal(prefetcher.activeCount, 0);
});

test('loader failures are swallowed and do not block the queue', async () => {
  const loaded: string[] = [];
  const prefetcher = new CityPrefetcher(async (city) => {
    if (city === 'bad') throw new Error('boom');
    loaded.push(city);
  }, 2);
  prefetcher.enqueue(['bad', 'ok'], 'viewport');
  await flush();
  await flush();
  assert.deepEqual(loaded, ['ok']);
});
