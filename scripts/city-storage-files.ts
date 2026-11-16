import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { cityRecords, MAX_CITY_BYTES } from '../src/utils/cityTransfer';
import { CITY_FILE_BYTES, CITY_STORAGE_FORMAT } from '../src/utils/cityStorage';
import type { CityDataset } from '../src/utils/cityDataset';
export function cityContentHash(data: CityDataset) {
  const hash = createHash('sha256');
  for (const record of cityRecords({ ...data, capturedAt: '' })) hash.update(record);
  return hash.digest('hex');
}
export function cityContentBytes(data: CityDataset) {
  let bytes = 0;
  for (const record of cityRecords(data)) {
    bytes += Buffer.byteLength(record);
    if (bytes > MAX_CITY_BYTES) throw Object.assign(Error('城市快照超过1GB（1GiB）。'), { status: 413 });
  }
  return bytes;
}
/** Large snapshots share immutable <=8MiB parts between latest and historical manifests. */
export function* cityStorageFiles(data: CityDataset, prefix: string, id: string, promoted: boolean, fileLimit = CITY_FILE_BYTES) {
  if (cityContentBytes(data) <= fileLimit) {
    const content = JSON.stringify(data);
    yield { path: `${prefix}/history/${id}.json`, content };
    if (promoted) yield { path: `${prefix}/latest.json`, content };
    return;
  }
  const { lines, stops, ...header } = data;
  const parts: string[] = [];
  let lineRecords: string[] = [], stopRecords: string[] = [], bytes = 24;
  const compress = (file: { path: string; content: string }) => ({ ...file,
    content: JSON.stringify({ encoding: 'gzip-base64', data: gzipSync(file.content).toString('base64') }) });
  const flush = () => {
    const path = `parts/${id}/${parts.length}.json`;
    parts.push(path);
    const file = { path: `${prefix}/${path}`, content: `{"lines":[${lineRecords.join(',')}],"stops":[${stopRecords.join(',')}]}` };
    lineRecords = []; stopRecords = []; bytes = 24;
    return file;
  };
  for (const [kind, records] of [['stops', stops], ['lines', lines]] as const) {
    for (const record of records) {
      const text = JSON.stringify(record), size = Buffer.byteLength(text) + 1;
      if (size + 24 > fileLimit) throw Error('单条线路超过分片上限。');
      if (bytes + size > fileLimit) yield compress(flush());
      (kind === 'lines' ? lineRecords : stopRecords).push(text); bytes += size;
    }
  }
  if (lineRecords.length || stopRecords.length) yield compress(flush());
  const content = JSON.stringify({ storage: CITY_STORAGE_FORMAT, header, parts });
  yield { path: `${prefix}/history/${id}.json`, content };
  if (promoted) yield { path: `${prefix}/latest.json`, content };
}
