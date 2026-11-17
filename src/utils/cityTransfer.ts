import type { CityDataset } from './cityDataset';
// One shared budget throughout the browser, gateway and publisher (1 GiB).
export const MAX_CITY_BYTES = 1024 * 1024 * 1024;
export const CITY_CHUNK_BYTES = 256 * 1024;
export const CITY_RECORD_FORMAT = 'city-records-v1';
export const CITY_UPLOAD_FORMAT = 'city-records-gzip-v1';
/** Bounded records avoid V8's maximum string size and a city-sized stringify copy. */
export function* cityRecords(data: CityDataset): Generator<string> {
  const { lines, stops, ...header } = data;
  yield JSON.stringify({ header }) + '\n';
  for (const stop of stops) yield JSON.stringify({ stop }) + '\n';
  for (const line of lines) yield JSON.stringify({ line }) + '\n';
}
export async function cityUploadBlob(data: CityDataset): Promise<Blob> {
  const blocks: Blob[] = []; let records: string[] = [], length = 0, started = performance.now();
  for (const record of cityRecords(data)) {
    records.push(record); length += record.length;
    if (length >= 1024 * 1024) { blocks.push(new Blob(records)); records = []; length = 0; }
    if (performance.now() - started > 8) { await new Promise(r => setTimeout(r, 0)); started = performance.now(); }
  }
  if (records.length) blocks.push(new Blob(records));
  const blob=new Blob(blocks, { type: 'application/x-ndjson' });
  if(blob.size>MAX_CITY_BYTES)throw Error('本次数据超过1GB（1GiB），仍可在当前地图中查看。');
  return blob;
}
/** SHA256 of ordered chunk SHA256s: bounded memory, detects corruption/reordering. */
export async function cityBlobHash(blob: Blob): Promise<string> {
  const hashes = new Uint8Array(Math.ceil(blob.size / CITY_CHUNK_BYTES) * 32);
  for (let at = 0, part = 0; at < blob.size; at += CITY_CHUNK_BYTES, part++) {
    hashes.set(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.slice(at, at + CITY_CHUNK_BYTES).arrayBuffer())), part * 32);
  }
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', hashes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
