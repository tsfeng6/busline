import { cityDataKey, type CityDataset } from './cityDataset';

export type CityLoader = (city: string) => Promise<CityDataset | null>;

interface CacheEntry { data: CityDataset; bytes: number; at: number; pinned: boolean; }

/** Rough in-memory footprint estimate; a heuristic for the cache budget, not an exact measurement. */
export function estimateCityBytes(data: CityDataset): number {
  let bytes = 0;
  for (const line of data.lines || []) {
    bytes += (line.name?.length || 0) + (line.path?.length || 0) * 32 + 64;
    bytes += (line.via_stops?.length || 0) * 40;
  }
  for (const stop of data.stops || []) bytes += (stop.name?.length || 0) + 48;
  return bytes;
}

const safeKey = (city: string): string => { try { return cityDataKey(city); } catch { return city.trim(); } };

/**
 * Byte-budgeted LRU cache over whole-city datasets. Viewport cities are pinned
 * (not evictable); prefetched neighbors are evictable. In-flight loads are
 * single-flighted per city, and `invalidate()` bumps a generation so late
 * resolutions are not re-inserted after a catalog revision change.
 */
export class CityDataCache {
  private entries = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<CityDataset | null>>();
  private totalBytes = 0;
  private generation = 0;

  constructor(
    private readonly load: CityLoader,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  get bytes(): number { return this.totalBytes; }
  get count(): number { return this.entries.size; }

  async get(city: string, opts: { pin?: boolean } = {}): Promise<CityDataset | null> {
    const key = safeKey(city);
    const cached = this.entries.get(key);
    if (cached) { this.touch(cached); if (opts.pin) cached.pinned = true; return cached.data; }

    let task = this.inflight.get(key);
    if (!task) {
      const gen = this.generation;
      task = this.load(city)
        .then(data => { if (data && gen === this.generation) this.insert(key, data, opts.pin); return data; })
        .finally(() => { if (this.inflight.get(key) === task) this.inflight.delete(key); });
      this.inflight.set(key, task);
    }
    return task;
  }

  /** Synchronous cache read: returns the cached dataset or null, without triggering a load. */
  peek(city: string, opts: { pin?: boolean } = {}): CityDataset | null {
    const entry = this.entries.get(safeKey(city));
    if (!entry) return null;
    this.touch(entry);
    if (opts.pin) entry.pinned = true;
    return entry.data;
  }

  pin(city: string): void { const entry = this.entries.get(safeKey(city)); if (entry) entry.pinned = true; }
  unpin(city: string): void { const entry = this.entries.get(safeKey(city)); if (entry) entry.pinned = false; }

  invalidate(): void { this.generation++; this.entries.clear(); this.totalBytes = 0; }

  private insert(key: string, data: CityDataset, pin?: boolean): void {
    const bytes = estimateCityBytes(data);
    this.entries.set(key, { data, bytes, at: Date.now(), pinned: !!pin });
    this.totalBytes += bytes;
    this.evict();
  }

  private touch(entry: CacheEntry): void { entry.at = Date.now(); }

  private evict(): void {
    if (this.totalBytes <= this.maxBytes) return;
    const unpinned = [...this.entries.entries()]
      .filter(([, entry]) => !entry.pinned)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [key, entry] of unpinned) {
      if (this.totalBytes <= this.maxBytes) break;
      this.entries.delete(key);
      this.totalBytes -= entry.bytes;
    }
  }
}
