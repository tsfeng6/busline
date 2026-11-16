import type { CityDataset } from './cityDataset';
export const CITY_STORAGE_FORMAT = 'city-parts-v1';
export const CITY_FILE_BYTES = 8 * 1024 * 1024;
export interface CityPartsManifest { storage: typeof CITY_STORAGE_FORMAT; header: Omit<CityDataset, 'lines' | 'stops'>; parts: string[] }
export function isCityParts(value: any): value is CityPartsManifest { return value?.storage === CITY_STORAGE_FORMAT; }
export function validateCityPart(path: string) {
  if (!/^parts\/[\dTZ-]+-[a-f0-9]{12}\/\d+\.json$/.test(path)) throw Error('城市分片路径无效。');
  return path;
}
export async function decodeCityPart(value: any) {
  if (value?.encoding !== 'gzip-base64') return value;
  if (typeof value.data !== 'string' || value.data.length > 16 * 1024 * 1024) throw Error('压缩分片无效。');
  const bytes = Uint8Array.from(atob(value.data), c => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder(); let text = '', size = 0;
  for (;;) {
    const { done, value: chunk } = await reader.read(); if (done) break;
    size += chunk.byteLength;
    if (size > CITY_FILE_BYTES) { await reader.cancel(); throw Error('解压分片过大。'); }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode(); return JSON.parse(text);
}
export async function resolveCityParts(value: any, read: (path: string) => Promise<any>) {
  if (!isCityParts(value)) return value;
  if (!Array.isArray(value.parts) || !value.parts.length || value.parts.length > 256) throw Error('城市分片清单无效。');
  const data: any = { ...value.header, lines: [], stops: [] };
  for (const path of value.parts) {
    const part = await decodeCityPart(await read(validateCityPart(path)));
    if (!Array.isArray(part.lines) || !Array.isArray(part.stops)) throw Error('城市分片内容无效。');
    for (const line of part.lines) data.lines.push(line);
    for (const stop of part.stops) data.stops.push(stop);
  }
  return data;
}
