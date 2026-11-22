import type { TransitTileData } from './transitTiles';

type LoadTile = (key: string, signal: AbortSignal) => Promise<TransitTileData>;

/** One scheduler per mounted map. Only the current viewport may admit a response. */
export class TransitTileCache {
  private entries = new Map<string, TransitTileData>();
  private active = new Map<string, AbortController>();
  private retryAt = new Map<string, number>();
  private visible: string[] = [];
  private neighbors: string[] = [];
  private wanted = new Set<string>();
  private idle = false;
  private disposed = false;
  private paused = false;
  private totalBytes = 0;

  constructor(
    private load: LoadTile,
    private changed: () => void,
    private budget: number,
    private concurrency: number,
    private now = Date.now,
  ) {}

  get bytes() { return this.totalBytes; }

  get(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  has(key: string) { return this.entries.has(key); }

  update(visible: string[], neighbors: string[], idle = false) {
    this.paused = false;
    for (const [key, until] of this.retryAt) if (until <= this.now()) this.retryAt.delete(key);
    this.visible = visible;
    this.neighbors = neighbors;
    this.idle = idle;
    this.wanted = new Set([...visible, ...neighbors]);
    const visibleKeys = new Set(visible);
    const waiting = visible.some(key => !this.has(key) && !this.active.has(key) && !this.retryAt.has(key));
    for (const [key, controller] of this.active) {
      if (!this.wanted.has(key) || (waiting && !visibleKeys.has(key))) {
        this.active.delete(key);
        controller.abort();
      }
    }
    this.pump();
  }

  pause() {
    this.paused = true;
    for (const [key, controller] of this.active) {
      if (this.visible.includes(key)) continue;
      this.active.delete(key);
      controller.abort();
    }
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.entries.clear();
    this.retryAt.clear();
    this.totalBytes = 0;
  }

  private pump() {
    if (this.disposed || this.paused) return;
    const request = (key: string) => !this.has(key) && !this.active.has(key) && !this.retryAt.has(key);
    const queue = this.visible.filter(request);
    if (this.idle && !queue.length && !this.visible.some(key => this.active.has(key))) {
      if (this.active.size) return;
      queue.push(...this.neighbors.filter(request).slice(0, 1));
    }
    for (const key of queue) {
      if (this.active.size >= this.concurrency) break;
      const controller = new AbortController();
      this.active.set(key, controller);
      void this.load(key, controller.signal).then(tile => {
        if (this.active.get(key) !== controller) return;
        // Keep current coverage ahead of speculative entries, with a hard decoded-byte cap.
        if (tile.bytes > this.budget) {
          this.defer(key);
          return;
        }
        while (this.totalBytes + tile.bytes > this.budget) {
          const candidate = [...this.entries.keys()].find(key => !this.visible.includes(key));
          if (candidate === undefined) {
            this.defer(key);
            return;
          }
          this.totalBytes -= this.entries.get(candidate)!.bytes;
          this.entries.delete(candidate);
        }
        this.totalBytes += tile.bytes;
        this.entries.set(key, tile);
        this.changed();
      }).catch(() => {
        if (this.active.get(key) === controller) this.defer(key);
      }).finally(() => {
        if (this.active.get(key) !== controller) return;
        this.active.delete(key);
        this.pump();
      });
    }
  }

  private defer(key: string) {
    this.retryAt.set(key, this.now() + 10000);
    if (this.retryAt.size > 512) this.retryAt.delete(this.retryAt.keys().next().value!);
  }
}
