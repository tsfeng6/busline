/** Discover city bus stops district by district, with bounded sequential requests. */
export async function discoverCityStops(AMap: any, city: string, cancelled: () => boolean,
  checkQuota: (status: string, result: any) => void): Promise<{ pois: any[]; complete: boolean }> {
  const request = (invoke: (callback: (status: string, result: any) => void) => void) =>
    new Promise<{ status: string; result: any }>(resolve => {
      let settled = false;
      const finish = (status: string, result: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status, result });
      };
      const timer = setTimeout(() => finish('timeout', null), 10000);
      try { invoke(finish); } catch { finish('error', null); }
    });
  const districts = await request(callback => new AMap.DistrictSearch({ subdistrict: 1, extensions: 'base' }).search(city, callback));
  if (cancelled()) return { pois: [], complete: false };
  const children = districts.result?.districtList?.[0]?.districtList || [];
  const scopes: string[] = Array.from(new Set<string>(children
    .filter((district: any) => district.level === 'district')
    .map((district: any) => String(district.adcode || district.name))));
  // Fallback remains usable when administrative lookup is unavailable, but cannot
  // claim complete city coverage or suppress a future attempt with a cache hit.
  let complete = scopes.length > 0;
  if (!scopes.length) scopes.push(city);
  const found = new Map<string, any>();
  for (const scope of scopes) {
    if (cancelled()) return { pois: [], complete: false };
    const search = new AMap.PlaceSearch({ city: scope, citylimit: true,
      type: '公交车站', pageSize: 50, pageIndex: 1, extensions: 'all' });
    let fetched = 0;
    const pageSignatures = new Set<string>();
    for (let page = 1; page <= 100; page++) {
      if (cancelled()) return { pois: [], complete: false };
      const response = await request(callback => {
        search.setPageIndex(page);
        search.search('', callback);
      });
      if (cancelled()) return { pois: [], complete: false };
      checkQuota(response.status, response.result);
      if (response.status === 'no_data') { if (page > 1) complete = false; break; }
      const list = response.result?.poiList;
      if (response.status !== 'complete' || !Array.isArray(list?.pois)) { complete = false; break; }
      const total = Number(list.count || 0);
      if (!list.pois.length) { if (fetched < total) complete = false; break; }
      const signature = list.pois.map((poi: any) => poi.id || `${poi.name}:${poi.location?.lng},${poi.location?.lat}`).join('|');
      if (pageSignatures.has(signature)) { complete = false; break; }
      pageSignatures.add(signature);
      fetched += list.pois.length;
      for (const poi of list.pois) {
        if (!poi.location) continue;
        found.set(poi.id || `${poi.name}:${poi.location.lng},${poi.location.lat}`, poi);
      }
      if (fetched >= total) break;
      if (page === 100) complete = false;
    }
  }
  return { pois: Array.from(found.values()), complete };
}
