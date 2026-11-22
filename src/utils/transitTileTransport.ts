import { transitPackLocation, type TransitTileData, type TransitTileIndex } from './transitTiles';

export function transitTileTransport(index: TransitTileIndex, base: string) {
  const worker = new Worker(new URL('../workers/transitTile.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 0, failed = false;
  const pending = new Map<number, (tile?: TransitTileData) => void>();
  worker.onmessage = ({ data }: MessageEvent<{ id: number; tile?: TransitTileData }>) => pending.get(data.id)?.(data.tile);
  const stop = () => {
    failed = true;
    for (const settle of pending.values()) settle();
    worker.terminate();
  };
  worker.onerror = stop;
  return {
    load(key: string, signal: AbortSignal): Promise<TransitTileData> {
      return new Promise((resolve, reject) => {
        if (failed || signal.aborted) { reject(Error('Transit worker unavailable')); return; }
        const id = ++nextId;
        const abort = () => {
          worker.postMessage({ id });
          settle();
        };
        const settle = (tile?: TransitTileData) => {
          pending.delete(id);
          signal.removeEventListener('abort', abort);
          if (tile) resolve(tile);
          else reject(Error('Transit tile unavailable'));
        };
        pending.set(id, settle);
        signal.addEventListener('abort', abort, { once: true });
        const [z, x, y] = key.split('/').map(Number);
        const pack = transitPackLocation({ z, x, y });
        const descriptor = index.groups[pack.key];
        if (!descriptor) { settle(); return; }
        const url = new URL(`${base}city-data/v1/${index.base}/${pack.key}-${descriptor[1]}.pack`, document.baseURI);
        worker.postMessage({ id, url: url.href, slot: pack.slot, slots: pack.slots });
      });
    },
    stop,
  };
}
