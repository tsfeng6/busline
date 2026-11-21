export type PrefetchPriority = 'viewport' | 'buffer' | 'neighbor';

const PRIORITY_WEIGHT: Record<PrefetchPriority, number> = { viewport: 0, buffer: 1, neighbor: 2 };

interface Task { city: string; priority: PrefetchPriority; }

export type PrefetchLoader = (city: string, priority: PrefetchPriority) => Promise<unknown>;

/**
 * Priority queue that loads city datasets in the background. Lower weight wins:
 * viewport > buffer > neighbor. Bounded concurrency keeps prefetching from
 * saturating the main viewport load; `setViewport` re-prioritizes the queue and
 * `cancel` drops pending work. In-flight loads are not aborted because the
 * city loader manages its own timeout; "cancel" only stops future dequeues.
 */
export class CityPrefetcher {
  private queue = new Map<string, PrefetchPriority>();
  private inflight = 0;
  private draining = false;

  constructor(
    private readonly load: PrefetchLoader,
    private readonly concurrency = 2,
  ) {}

  get pendingCount(): number { return this.queue.size; }
  get activeCount(): number { return this.inflight; }

  setViewport(cities: string[]): void {
    this.queue.clear();
    this.enqueue(cities, 'viewport');
  }

  enqueue(cities: string[], priority: PrefetchPriority): void {
    for (const city of cities) {
      const existing = this.queue.get(city);
      if (existing === undefined || PRIORITY_WEIGHT[priority] < PRIORITY_WEIGHT[existing]) {
        this.queue.set(city, priority);
      }
    }
    void this.drain();
  }

  cancel(): void { this.queue.clear(); }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.size > 0 && this.inflight < this.concurrency) {
        const task = this.nextTask();
        if (!task) break;
        this.queue.delete(task.city);
        this.inflight++;
        void this.load(task.city, task.priority)
          .catch(() => { /* prefetch failures must not surface; the viewport path reports errors */ })
          .finally(() => {
            this.inflight--;
            void this.drain();
          });
      }
    } finally {
      this.draining = false;
    }
  }

  private nextTask(): Task | null {
    let best: Task | null = null;
    let bestWeight = Infinity;
    for (const [city, priority] of this.queue) {
      const weight = PRIORITY_WEIGHT[priority];
      if (weight < bestWeight) { bestWeight = weight; best = { city, priority }; }
    }
    return best;
  }
}
