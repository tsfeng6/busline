import { decodeTransitTile } from '../utils/transitTileDecode';
import { MAX_TRANSIT_PACK_BYTES, transitPackTile } from '../utils/transitTiles';

type PackRequest = { controller: AbortController; promise: Promise<Uint8Array>; users: number };

const active = new Map<number, AbortController>();
const loading = new Map<string, PackRequest>();
const cached = new Map<string, Uint8Array>();
const budget = 4 * 1024 * 1024;
let cachedBytes = 0;

async function readPack(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, redirect: 'error', cache: 'force-cache' });
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > MAX_TRANSIT_PACK_BYTES) {
    throw Error('Transit pack unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_TRANSIT_PACK_BYTES) throw Error('Transit pack too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const pack = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    pack.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return pack;
}

function acquire(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const entry = cached.get(url);
  if (entry) {
    cached.delete(url);
    cached.set(url, entry);
    return Promise.resolve(entry);
  }

  let task = loading.get(url);
  if (!task) {
    const controller = new AbortController();
    const promise = readPack(url, controller.signal).then(pack => {
      controller.signal.throwIfAborted();
      while (cachedBytes + pack.byteLength > budget) {
        const key = cached.keys().next().value!;
        cachedBytes -= cached.get(key)!.byteLength;
        cached.delete(key);
      }
      cachedBytes += pack.byteLength;
      cached.set(url, pack);
      return pack;
    }).finally(() => {
      if (loading.get(url)?.controller === controller) loading.delete(url);
    });
    task = { controller, promise, users: 0 };
    loading.set(url, task);
  }

  const request = task;
  request.users++;
  return new Promise((resolve, reject) => {
    const release = () => {
      signal.removeEventListener('abort', abort);
      request.users--;
      if (!request.users && loading.get(url) === request) {
        loading.delete(url);
        request.controller.abort();
      }
    };
    const abort = () => { release(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    void request.promise.then(pack => {
      if (signal.aborted) return;
      release();
      resolve(pack);
    }, error => {
      if (signal.aborted) return;
      release();
      reject(error);
    });
  });
}

self.onmessage = ({ data }: MessageEvent<{ id: number; url?: string; slot: number; slots: number }>) => {
  const { id, url, slot, slots } = data;
  if (!url) {
    active.get(id)?.abort();
    return;
  }
  const controller = new AbortController();
  active.set(id, controller);
  const timeout = setTimeout(() => controller.abort(), 20000);
  void (async () => {
    try {
      const pack = await acquire(url, controller.signal);
      controller.signal.throwIfAborted();
      const part = transitPackTile(pack, slot, slots);
      const stream = new ReadableStream<Uint8Array>({ start(writer) { writer.enqueue(part); writer.close(); } });
      const tile = await decodeTransitTile(stream.pipeThrough(new DecompressionStream('gzip')), controller.signal);
      controller.signal.throwIfAborted();
      self.postMessage({ id, tile }, { transfer: tile.routes.flatMap(route => route.paths.map(path => path.buffer)) });
    } catch {
      self.postMessage({ id });
    } finally {
      clearTimeout(timeout);
      active.delete(id);
    }
  })();
};
