import { districtSearchScopes } from './searchCity';

type SearchResult = { status: string; result: any };
type Callback = (status: string, result: any) => void;

function requestOnce(invoke: (callback: Callback) => void): Promise<SearchResult> {
  return new Promise(resolve => {
    const finish: Callback = (status, result) => {
      clearTimeout(timer);
      resolve({ status, result });
    };
    const timer = setTimeout(() => finish('timeout', null), 10000);
    try { invoke(finish); } catch { finish('error', null); }
  });
}

async function request(invoke: (callback: Callback) => void): Promise<SearchResult> {
  const first = await requestOnce(invoke);
  const status = typeof first.result === 'string' ? first.result : String(first.result?.info || first.result?.infocode || '');
  if (!/QPS|FREQUENT|^10004$/i.test(status)) return first;
  await new Promise(resolve => setTimeout(resolve, 750));
  return requestOnce(invoke);
}

type SearchBounds = [number, number, number, number];
type Area = { scope: string; bounds?: SearchBounds; depth: number };
const PAGE_SIZE = 25;
const STOP_CAP = 200;

/** Search county and district scopes independently and split capped POI results geographically. */
export async function discoverCityStops(services: any, city: string, cancelled: () => boolean,
  checkQuota: (status: string, result: any) => unknown, { maxRequests = 1200, preferredScope = '', focusBounds }: {
    maxRequests?: number; preferredScope?: string; focusBounds?: SearchBounds;
  } = {}): Promise<{ pois: any[]; complete: boolean }> {
  const district = (scope: string, subdistrict: number, extensions: string) =>
    request(callback => new services.DistrictSearch({ subdistrict, extensions }).search(scope, callback));

  const response = await district(city, 2, 'base');
  const root = response.result?.districtList?.[0];
  const scopes = districtSearchScopes(root?.districtList || []).filter(code => code !== root.adcode);
  if (scopes.includes(preferredScope)) scopes.unshift(...scopes.splice(scopes.indexOf(preferredScope), 1));
  const areas: Area[] = (scopes.length ? scopes : [city]).map(scope => ({ scope, depth: 0 }));
  if (focusBounds && Math.max(focusBounds[2] - focusBounds[0], focusBounds[3] - focusBounds[1]) < 0.5) {
    areas.unshift({ scope: scopes.includes(preferredScope) ? preferredScope : city, bounds: focusBounds, depth: 0 });
  }
  const found = new Map<string, any>();
  let complete = response.status === 'complete' && !!root && (scopes.length > 0 || root.level === 'district');
  let requests = 0;

  for (let index = 0; index < areas.length; index++) {
    if (cancelled()) return { pois: [], complete: false };
    const area = areas[index];
    const search = new services.PlaceSearch({ city: area.scope, citylimit: true,
      type: '公交车站', pageSize: PAGE_SIZE, extensions: 'all' });
    let fetched = 0, expected = Infinity, saturated = false;
    const seen = new Set<string>();
    for (let page = 1; page <= STOP_CAP / PAGE_SIZE; page++) {
      if (requests >= maxRequests) return { pois: [...found.values()], complete: false };
      requests++;
      const { status, result } = await request(callback => {
        search.setPageIndex(page);
        if (area.bounds) {
          const [west, south, east, north] = area.bounds;
          search.searchInBounds('', [[west, south], [east, north]], callback);
        } else search.search('', callback);
      });
      if (cancelled()) return { pois: [], complete: false };
      if (checkQuota(status, result) === true) return { pois: [...found.values()], complete: false };
      if (status === 'no_data') {
        saturated = fetched > 0 && fetched < expected;
        break;
      }
      const list = result?.poiList;
      if (status !== 'complete' || !Array.isArray(list?.pois)) { complete = false; break; }
      const items = list.pois;
      if (list.count != null && list.count !== '' && Number.isFinite(Number(list.count))) expected = Number(list.count);
      const signature = items.map((poi: any) => poi.id || `${poi.name}:${poi.location?.lng},${poi.location?.lat}`).join('|');
      if (!items.length || seen.has(signature)) { saturated = fetched < expected; break; }
      seen.add(signature);
      fetched += items.length;
      for (const poi of items) {
        if (!poi.location) { complete = false; continue; }
        const key = poi.id || `${poi.name}:${poi.location.lng},${poi.location.lat}`;
        const previous = found.get(key);
        const address = [...new Set([previous?.address, poi.address].flatMap(value =>
          typeof value === 'string' ? value.split(/[;；]/).map(name => name.trim()).filter(Boolean) : []))].join(';');
        found.set(key, { ...poi, address, searchScope: /^\d{6}$/.test(poi.adcode) ? String(poi.adcode) : area.scope });
      }
      if (expected >= STOP_CAP && Number.isFinite(expected) || fetched >= STOP_CAP) { saturated = true; break; }
      if (fetched >= expected || !Number.isFinite(expected) && items.length < PAGE_SIZE) break;
      if (page === STOP_CAP / PAGE_SIZE) saturated = true;
    }
    if (!saturated) continue;
    let bounds = area.bounds;
    if (!bounds) {
      const detail = await district(area.scope, 0, 'all');
      if (cancelled()) return { pois: [], complete: false };
      const paths = detail.result?.districtList?.[0]?.boundaries || [];
      const points = paths.flat().filter((point: any) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat));
      if (points.length) {
        bounds = [180, 90, -180, -90];
        for (const { lng, lat } of points) {
          bounds[0] = Math.min(bounds[0], lng); bounds[1] = Math.min(bounds[1], lat);
          bounds[2] = Math.max(bounds[2], lng); bounds[3] = Math.max(bounds[3], lat);
        }
      }
    }
    if (!bounds || area.depth >= 12 || Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) < 0.002) {
      complete = false;
      continue;
    }
    const [west, south, east, north] = bounds;
    const x = (west + east) / 2, y = (south + north) / 2;
    for (const box of [[west, south, x, y], [x, south, east, y], [west, y, x, north], [x, y, east, north]] as const) {
      areas.push({ scope: area.scope, bounds: [...box], depth: area.depth + 1 });
    }
  }
  return { pois: [...found.values()], complete };
}

/** Read line pages using the provider's total, with repeated-page detection. */
export async function searchCityLine(services: any, city: string, query: string, cancelled: () => boolean,
  checkQuota: (status: string, result: any) => unknown): Promise<{ lines: any[]; complete: boolean }> {
  const search = new services.LineSearch({ city, pageIndex: 1, pageSize: 20, extensions: 'all' });
  const lines = new Map<string, any>();
  let complete = true, received = 0;
  for (let page = 1; page <= 100 && !cancelled(); page++) {
    const { status, result } = await request(callback => {
      if (page > 1) search.setPageIndex(page);
      search.search(query, callback);
    });
    if (cancelled()) break;
    checkQuota(status, result);
    if (status === 'no_data' && page === 1) return { lines: [], complete: true };
    if (status !== 'complete' || !Array.isArray(result?.lineInfo)) break;
    const before = lines.size;
    received += result.lineInfo.length;
    for (const line of result.lineInfo) {
      if (line?.name && Array.isArray(line.path) && line.path.length >= 2) lines.set(line.id || line.name, line);
      else complete = false;
    }
    const total = Number(result.count ?? result.total);
    if (Number.isFinite(total) && total > 0 ? received >= total : result.lineInfo.length < 20) {
      return { lines: [...lines.values()], complete: complete && lines.size > 0 && lines.size > before };
    }
    if (lines.size === before) break;
  }
  return { lines: [...lines.values()], complete: false };
}
