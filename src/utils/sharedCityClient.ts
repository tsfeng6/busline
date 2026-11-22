import { readCityJSON, sharedCityStaticURL, type CityReadOptions } from './sharedCityRead';
import { CityUpdateJobClient } from './cityUpdateJobs';
import { cityDataKey, normalizeCityDataset, usableCityDataset, previewableCityDataset, type CityDataset, type CitySnapshotMeta } from './cityDataset';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const gatewayBase = (import.meta.env.VITE_CITY_UPDATE_GATEWAY_URL || '').replace(/\/$/, '');
export const actionsCityUpdatesEnabled = import.meta.env.VITE_CITY_DATA_ENABLED === 'true' && import.meta.env.VITE_CITY_UPDATE_MODE === 'actions';
export const cityUpdateJobs = new CityUpdateJobClient(gatewayBase);
export const sharedCityDataEnabled = import.meta.env.VITE_CITY_DATA_ENABLED === 'true';
export const citySnapshotFresh = usableCityDataset;
export const citySnapshotPreviewable = previewableCityDataset;
async function read(city: string, suffix = '', version = '', expectedSnapshotId?: string, options: CityReadOptions = {}) {
  return readCityJSON(sharedCityStaticURL(city, suffix, version, import.meta.env.BASE_URL || '/'), undefined, { ...options, expectedSnapshotId });
}
type CityCheck = { data: CityDataset | null; status: 'ready' | 'missing' | 'unavailable' };
const cityLoads = new Map<string, Promise<CityCheck>>();
export function invalidateSharedCityRead(city: string) {
  const prefix = cityDataKey(city) + ':';
  for (const key of cityLoads.keys()) if (key.startsWith(prefix)) cityLoads.delete(key);
}
export async function inspectSharedCity(city: string, version = '', expectedSnapshotId?: string): Promise<CityCheck> {
  if (!sharedCityDataEnabled) return { data: null, status: 'unavailable' };
  const key = `${cityDataKey(city)}:${version}:${expectedSnapshotId || ''}`;
  let task = cityLoads.get(key);
  if (!task) {
    task = (async (): Promise<CityCheck> => {
      try {
        const data = normalizeCityDataset(await read(city, '', version, expectedSnapshotId));
        return cityDataKey(data.city) === cityDataKey(city) ? { data, status: 'ready' } : { data: null, status: 'unavailable' };
      } catch (error: any) { return { data: null, status: error.status === 404 ? 'missing' : 'unavailable' }; }
    })();
    cityLoads.set(key, task);
  }
  try { return await task; } finally { if (cityLoads.get(key) === task) cityLoads.delete(key); }
}
export async function loadSharedCity(city: string, version = '', expectedSnapshotId?: string): Promise<CityDataset | null> {
  return (await inspectSharedCity(city, version, expectedSnapshotId)).data;
}
/** Game reads need fast feedback on constrained mobile networks, unlike background map loads. */
export async function loadSharedCityForGame(city: string, onPart?: (completed: number, total: number) => void): Promise<CityDataset> {
  if (!sharedCityDataEnabled) throw Error('网站共享线路当前未启用。');
  const data = normalizeCityDataset(await read(city, '', '', undefined, { timeoutMs: 12000, partConcurrency: 4, onPart }));
  if (cityDataKey(data.city) !== cityDataKey(city)) throw Error('共享线路城市不匹配。');
  return data;
}
export async function acquireCityRefresh(city: string): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(`${apiBase}/api/city-data/${encodeURIComponent(city)}/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '暂时无法开始城市更新。'), { status: response.status });
  return result;
}
export async function releaseCityRefresh(city: string, token: string) {
  try { await fetch(`${apiBase}/api/city-data/${encodeURIComponent(city)}/refresh`, {
    method: 'DELETE', headers: { 'x-city-refresh-token': token }, signal: AbortSignal.timeout(5000),
  }); } catch { /* A cancelled browser may disconnect; the server lease also expires. */ }
}
export async function saveSharedCity(data: CityDataset, token: string) {
  const response = await fetch(`${apiBase}/api/city-data/${encodeURIComponent(data.city)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-city-refresh-token': token },
    body: JSON.stringify(data), signal: AbortSignal.timeout(180000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '城市快照保存失败。');
  return result;
}
export const listSharedCityHistory = (city: string): Promise<CitySnapshotMeta[]> => read(city, 'history');
