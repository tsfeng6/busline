import { MAX_TRANSIT_TILE_BYTES, TRANSIT_TILE_EXTENT, type TransitTileData } from './transitTiles';

/** Bound decoded input and release each JSON record as soon as its packed geometry is copied. */
export async function decodeTransitTile(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<TransitTileData> {
  const result: TransitTileData = { routes: [], stops: [], bytes: 0 };
  const reader = stream.pipeThrough(new TextDecoderStream('utf-8', { fatal: true })).getReader();
  const parse = (line: string) => {
    const [kind, city, id, name, ...fields] = JSON.parse(line);
    if (![city, id, name].every(value => typeof value === 'string') || !city || !name) throw Error('Invalid transit record');
    result.bytes += 128 + 2 * (city.length + id.length + name.length);
    if (kind === 0) {
      const paths = (fields[0] as number[][]).map(path => {
        if (path.length < 4 || path.length % 2 || !path.every(coordinate)) throw Error('Invalid transit path');
        result.bytes += 64 + path.length * 12; // Include the renderer’s cached path estimate.
        return Float32Array.from(path);
      });
      result.routes.push({ city, id, name, paths });
    } else if (kind === 1) {
      const [x, y, address, lines, terminal] = fields;
      if (!coordinate(x) || !coordinate(y) || typeof address !== 'string' || typeof terminal !== 'boolean'
        || !Array.isArray(lines) || !lines.every(name => typeof name === 'string')) throw Error('Invalid transit stop');
      result.bytes += address.length * 2 + lines.reduce((bytes, name) => bytes + 24 + name.length * 2, 0);
      result.stops.push({ city, id, name, x, y, address, lines, terminal });
    } else {
      throw Error('Unknown transit record');
    }
  };
  let pending = '', length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.length * 2;
      if (length > MAX_TRANSIT_TILE_BYTES * 2) throw Error('Transit tile too large');
      const records = (pending + value).split('\n');
      pending = records.pop()!;
      for (const record of records) if (record) parse(record);
    }
    if (pending) throw Error('Truncated transit tile');
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const coordinate = (value: number) => Number.isInteger(value) && value >= 0 && value <= TRANSIT_TILE_EXTENT;
