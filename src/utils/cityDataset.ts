import type { BusLine } from '../types';

export const CITY_DATA_SCHEMA = 1;
export interface CityDataset {
  schemaVersion: 1;
  city: string;
  scope: 'city';
  capturedAt: string;
  retrievalComplete: boolean;
  coverage: 'observed';
  filtered: boolean;
  stops: { id: string; name: string; address: string; location: { lng: number; lat: number } }[];
  lines: BusLine[];
}
export interface CitySnapshotMeta {
  id: string; city: string; capturedAt: string; lineDirections: number; stops: number;
  retrievalComplete: boolean; promoted: boolean; hash: string;
}
/** Two calendar months, clamping month-end dates instead of overflowing into the next month. */
export function cityDatasetExpiresAt(data: Pick<CityDataset, 'capturedAt'>): number {
  const chinaOffset = 8 * 3600000;
  const date = new Date(Date.parse(data.capturedAt) + chinaOffset);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 2);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime() - chinaOffset;
}
export function usableCityDataset(data: CityDataset, now = Date.now()): boolean {
  return data.retrievalComplete && !data.filtered && Date.parse(data.capturedAt) <= now + 300000
    && now < cityDatasetExpiresAt(data);
}
export function cityDataKey(city: string): string {
  if (typeof city !== 'string' || !/^[\p{L}\p{N}· -]{1,60}$/u.test(city.trim())) throw new Error('城市名称无效。');
  const key = city.trim().replace(/市$/, '');
  if (!key || key === '全国') throw new Error('城市名称无效。');
  return key;
}
const text = (value: unknown, max = 200): string => typeof value === 'string' ? value.slice(0, max) : '';
const location = (point: any): { lng: number; lat: number } => {
  const lng = Array.isArray(point) ? point[0] : point?.lng;
  const lat = Array.isArray(point) ? point[1] : point?.lat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error('线路或站点坐标无效。');
  return { lng: Math.round(lng * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 };
};
/** Whitelist transport fields: never serialize credentials, UI state or arbitrary properties. */
export function normalizeCityDataset(input: any): CityDataset {
  if (input?.schemaVersion !== 1 || input.scope !== 'city' || input.coverage !== 'observed'
    || typeof input.filtered !== 'boolean' || typeof input.retrievalComplete !== 'boolean') throw new Error('城市快照格式无效。');
  cityDataKey(input.city);
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 10000
    || !Array.isArray(input.stops) || input.stops.length > 100000) throw new Error('城市快照规模无效。');
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new Error('快照时间无效。');
  const stops = new Map<string, CityDataset['stops'][number]>();
  for (const stop of input.stops) {
    const loc = location(stop.location);
    const name = text(stop.name);
    if (name) stops.set(`${name}:${loc.lng},${loc.lat}`, { id: text(stop.id), name, address: text(stop.address, 12000), location: loc });
  }
  const lines = new Map<string, BusLine>();
  for (const line of input.lines) {
    if (line.isUserSubmitted) continue;
    if (!line.name || !Array.isArray(line.path) || line.path.length < 2 || line.path.length > 50000) throw new Error('线路路径无效。');
    if (line.city && cityDataKey(line.city) !== cityDataKey(input.city)) throw new Error('快照混入其他城市线路。');
    const name = text(line.name);
    lines.set(text(line.id) || name, {
      id: text(line.id), name, city: input.city, stops: [],
      path: line.path.map((point: any) => { const p = location(point); return [p.lng, p.lat]; }),
      via_stops: (Array.isArray(line.via_stops) ? line.via_stops : []).slice(0, 5000).map((stop: any) => ({ id: text(stop.id), name: text(stop.name), location: location(stop.location) })),
      start_stop: text(line.start_stop), end_stop: text(line.end_stop),
      stime: text(line.stime, 20), etime: text(line.etime, 20), scheduleDescription: text(line.scheduleDescription, 4000),
      scheduleDataVersion: Number.isInteger(line.scheduleDataVersion) ? line.scheduleDataVersion : undefined,
      sourceQueries: Array.isArray(line.sourceQueries) ? [...new Set<string>(line.sourceQueries.map((name: unknown) => text(name)).filter(Boolean))].slice(0, 200) : [],
    });
  }
  if (!lines.size || !stops.size) throw new Error('不能保存空城市快照。');
  return { schemaVersion: 1, city: input.city.trim(), scope: 'city', capturedAt: new Date(input.capturedAt).toISOString(),
    coverage: 'observed', retrievalComplete: input.retrievalComplete === true, filtered: input.filtered === true,
    lines: [...lines.values()].sort((a, b) => a.name.localeCompare(b.name)),
    stops: [...stops.values()].sort((a, b) => `${a.name}:${a.location.lng},${a.location.lat}`.localeCompare(`${b.name}:${b.location.lng},${b.location.lat}`)) };
}
