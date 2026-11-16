import { CityUpdateJobClient } from './cityUpdateJobs';
import { cityDataKey, normalizeCityDataset, usableCityDataset, previewableCityDataset, type CityDataset, type CitySnapshotMeta } from './cityDataset';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const gatewayBase = (import.meta.env.VITE_CITY_UPDATE_GATEWAY_URL || '').replace(/\/$/, '');
export const actionsCityUpdatesEnabled = import.meta.env.VITE_CITY_DATA_ENABLED === 'true' && import.meta.env.VITE_CITY_UPDATE_MODE === 'actions';
export const cityUpdateJobs = new CityUpdateJobClient(gatewayBase);
const readBase = (import.meta.env.VITE_CITY_DATA_READ_BASE_URL || '').replace(/\/$/, '');
export const sharedCityDataEnabled = import.meta.env.VITE_CITY_DATA_ENABLED === 'true';
export const citySnapshotFresh = usableCityDataset;
export const citySnapshotPreviewable = previewableCityDataset;
function readUrl(city: string, suffix = '') {
  const key = encodeURIComponent(cityDataKey(city));
  if (readBase) return `${readBase}/${key}/${suffix ? suffix + '.json' : 'latest.json'}`;
  return `${actionsCityUpdatesEnabled ? gatewayBase : apiBase}/api/city-data/${encodeURIComponent(city)}${suffix ? '/' + suffix : ''}`;
}
async function read(city: string, suffix = '', version = '') {
  const base = readUrl(city, suffix);
  const url = version ? `${base}?v=${encodeURIComponent(version)}` : base;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-cache' });
  if (!response.ok) throw Object.assign(new Error(response.status === 404 ? '该城市暂无历史快照。' : '共享线路服务暂时不可用。'), { status: response.status });
  return response.json();
}
type CityCheck = { data: CityDataset | null; status: 'ready' | 'missing' | 'unavailable' };
const cityLoads = new Map<string, Promise<CityCheck>>();
export async function inspectSharedCity(city: string, version = ''): Promise<CityCheck> {
  if (!sharedCityDataEnabled) return { data: null, status: 'unavailable' };
  const key = `${cityDataKey(city)}:${version}`;
  let task = cityLoads.get(key);
  if (!task) {
    task = (async (): Promise<CityCheck> => {
      try {
        const data = normalizeCityDataset(await read(city, '', version));
        return cityDataKey(data.city) === cityDataKey(city) ? { data, status: 'ready' } : { data: null, status: 'unavailable' };
      } catch (error: any) { return { data: null, status: error.status === 404 ? 'missing' : 'unavailable' }; }
    })();
    cityLoads.set(key, task);
  }
  try { return await task; } finally { if (cityLoads.get(key) === task) cityLoads.delete(key); }
}
export async function loadSharedCity(city: string, version = ''): Promise<CityDataset | null> { return (await inspectSharedCity(city, version)).data; }
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
export async function loadHistoricalCity(city: string, id: string): Promise<CityDataset> {
  if (!/^[\dTZ-]+-[a-f0-9]{12}$/.test(id)) throw new Error('快照版本无效。');
  return normalizeCityDataset(await read(city, `history/${id}`));
}
export function exportCityJSON(data: CityDataset) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${cityDataKey(data.city)}-${data.capturedAt.slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
