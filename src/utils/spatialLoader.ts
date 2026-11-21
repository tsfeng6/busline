import { loadSharedCity } from './sharedCityClient';
import { CityDataCache } from './cityDataCache';
import { CityPrefetcher } from './cityPrefetcher';

/**
 * Browser-side wiring for the spatial loader. Kept out of the pure
 * cityDataCache/cityPrefetcher modules because loadSharedCity reads
 * import.meta.env at module scope, which is unavailable under the node
 * test runner.
 */
export const cityDataCache = new CityDataCache(loadSharedCity);

// Eager: only the visible + near-visible cities. The user is actively looking
// at these, so a whole-city parse here is "on demand", not speculative.
export const cityPrefetcher = new CityPrefetcher(
  (city, priority) => cityDataCache.get(city, { pin: priority === 'viewport' }),
  2,
);

// Neighbor full-data prefetch is deferred to idle time, one city at a time,
// and capped by a byte budget. A whole-city decompress + JSON.parse is a
// main-thread long task; running it during interaction is what previously
// froze the page, so neighbors never compete with the viewport.
const neighborQueue = new Set<string>();
let neighborDraining = false;
const NEIGHBOR_SOFT_BUDGET = 16 * 1024 * 1024;

export function enqueueNeighborPrefetch(cities: string[]): void {
  for (const city of cities) neighborQueue.add(city);
  scheduleNeighborDrain();
}

export function cancelNeighborPrefetch(): void {
  neighborQueue.clear();
}

function scheduleNeighborDrain(): void {
  if (neighborDraining) return;
  neighborDraining = true;
  const run = () => {
    neighborDraining = false;
    if (cityDataCache.bytes >= NEIGHBOR_SOFT_BUDGET) return; // resume when the viewport frees budget
    const next = neighborQueue.values().next();
    if (next.done) return;
    const city = next.value;
    neighborQueue.delete(city);
    void cityDataCache.get(city, { pin: false }).catch(() => {});
    if (neighborQueue.size > 0) scheduleNeighborDrain();
  };
  const idle = (globalThis as any).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 4000 });
  else setTimeout(run, 1000);
}
