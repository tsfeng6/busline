import { normalizeCityDataset, cityDataKey, type CityDataset } from '../src/utils/cityDataset';
import { getOperatingHours } from '../src/utils/operatingHours';
import { lineBaseIdentity } from '../src/utils/lineIdentity';
import type { BusLine } from '../src/types';

type Options = {
  fetcher?: typeof fetch; wait?: () => Promise<void>; searchPages?: number; lineRequests?: number;
  onProgress?: (message: string) => Promise<void>;
};
const array = (value: any): any[] => Array.isArray(value) ? value : [];
const text = (value: any) => typeof value === 'string' ? value : '';
export function parseLocation(value: any): { lng: number; lat: number } | null {
  if (typeof value !== 'string') return null;
  const fields = value.split(',');
  if (fields.length !== 2 || fields.some(field => !field.trim())) return null;
  const [lng, lat] = fields.map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? { lng, lat } : null;
}
export function parseRestLine(info: any, city: string, query: string): BusLine | null {
  const path = text(info.polyline).split(';').map(parseLocation).filter((point): point is {lng:number;lat:number} => !!point);
  if (!text(info.name) || path.length < 2 || path.length > 50000) return null;
  return { id: text(info.id), name: info.name, city, sourceQueries: [query],
    path: path.map(point => [point.lng, point.lat]), stops: [],
    start_stop: text(info.start_stop), end_stop: text(info.end_stop), ...getOperatingHours(info),
    via_stops: array(info.busstops).flatMap(stop => {
      const location = parseLocation(stop.location);
      return location && text(stop.name) ? [{ id: text(stop.id), name: stop.name, location }] : [];
    }),
  };
}

/** Only documented REST endpoints; the Actions runner never needs browser credentials. */
export async function collectCityDataset(requestedCity: string, key: string, options: Options = {}) {
  cityDataKey(requestedCity);
  if (!key) throw new Error('未配置 Web 服务类型的高德 Key。');
  const transport = options.fetcher || fetch;
  const wait = options.wait || (() => new Promise(resolve => setTimeout(resolve, 400)));
  const searchPages = Math.max(1, Math.min(100, options.searchPages || 100));
  const maxLineRequests = Math.max(1, Math.min(3000, options.lineRequests || 1500));
  const counts = { district: 0, poi: 0, line: 0 };
  let retrievalComplete = true;
  const failedQueries = new Set<string>();
  const request = async (path: string, params: Record<string,string>, bucket: keyof typeof counts) => {
    await wait(); counts[bucket]++;
    const url = new URL(`https://restapi.amap.com${path}`);
    for (const [name, value] of Object.entries({...params, key, output:'JSON'})) url.searchParams.set(name,value);
    let response: Response;
    try { response = await transport(url, { signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('数据源网络请求失败，请稍后重试。'); }
    if (!response.ok) throw new Error(`数据源暂时不可用（HTTP ${response.status}）。`);
    let result: any;
    try { result = await response.json(); } catch { throw new Error('数据源返回格式异常。'); }
    if (String(result.status) !== '1') {
      const code = text(result.infocode).replace(/[^0-9]/g,'').slice(0,8);
      // Never log request URLs, raw provider messages or key-bearing errors.
      throw Object.assign(new Error(`数据源拒绝请求${code ? `（${code}）` : ''}，可能涉及权限、额度或请求限制。`),{fatal:true});
    }
    return result;
  };
  await options.onProgress?.('正在确认城市。');
  const districts = await request('/v3/config/district', { keywords: requestedCity, subdistrict:'0', extensions:'base' }, 'district');
  const district = array(districts.districts).find(item => text(item.name) && cityDataKey(item.name) === cityDataKey(requestedCity));
  const municipalities = new Set(['北京市','上海市','天津市','重庆市']);
  if (!district || !['city','district'].includes(district.level) && !municipalities.has(district.name)) throw new Error('无法确认该城市或地区，请检查名称。');
  const city = district.name;
  const scope = text(district.adcode) || city;
  const stops = new Map<string, CityDataset['stops'][number]>();
  const queries = new Map<string,string>();
  const seenPoiPages = new Set<string>();
  let fetched = 0, lastTotal = Infinity;
  await options.onProgress?.(`正在发现${city}公交站点。`);
  for (let page=1;page<=searchPages;page++) {
    let result: any;
    try { result = await request('/v3/place/text', {city:scope,citylimit:'true',types:'150700',keywords:'',offset:'25',page:String(page),extensions:'all'},'poi'); }
    catch (error) { if (!stops.size) throw error; retrievalComplete=false; break; }
    const pois = array(result.pois);
    const total = Number(result.count);
    if (Number.isFinite(total) && total > 0) lastTotal = total;
    if (!pois.length) { if (fetched < lastTotal && fetched) retrievalComplete=false; break; }
    const signature = pois.map(poi => text(poi.id) || `${poi.name}:${poi.location}`).join('|');
    if (seenPoiPages.has(signature)) { retrievalComplete=false; break; }
    seenPoiPages.add(signature); fetched+=pois.length;
    for (const poi of pois) {
      const location = parseLocation(poi.location);
      if (!location || !text(poi.name)) { retrievalComplete=false;continue; }
      const address = text(poi.address);
      stops.set(`${poi.name}:${location.lng},${location.lat}`,{id:text(poi.id),name:poi.name,address,location});
      for (const name of address.split(/[;；]/).map(part=>part.trim()).filter(Boolean)) queries.set(lineBaseIdentity(name),name);
    }
    if (fetched >= lastTotal || !Number.isFinite(lastTotal) && pois.length < 25) break;
    if (page === searchPages) retrievalComplete=false;
  }
  if (!stops.size || !queries.size) throw new Error('没有取得可用的公交站点或线路，未发布空快照。');
  const lines = new Map<string,BusLine>();
  const queue = [...queries.values()];
  await options.onProgress?.(`发现${stops.size}个站点，正在查询${queue.length}个线路名称。`);
  lineLoop: for (let index=0;index<queue.length;index++) {
    const query = queue[index].replace(/[（(].*$/,'');
    let matched = false, received = 0, expected = Infinity;
    const seenPages = new Set<string>();
    for (let page=1;page<=10;page++) {
      if (counts.line>=maxLineRequests) { retrievalComplete=false;failedQueries.add(query);break; }
      let result:any;
      try { result=await request('/v3/bus/linename',{city:scope,keywords:query,offset:'100',page:String(page),extensions:'all'},'line'); }
      catch (error:any) {
        retrievalComplete=false;failedQueries.add(query);
        if(error.fatal){queue.slice(index+1).forEach(name=>failedQueries.add(name));break lineLoop;}
        break;
      }
      const buslines=array(result.buslines);
      if (!buslines.length) { if (!matched || Number.isFinite(expected) && received<expected) { retrievalComplete=false;failedQueries.add(query); } break; }
      const pageKey=buslines.map(line=>line.id||line.name).join('|');
      if(seenPages.has(pageKey)){retrievalComplete=false;failedQueries.add(query);break;}
      seenPages.add(pageKey);
      received+=buslines.length;
      for (const info of buslines) {
        const line=parseRestLine(info,city,query);
        if (!line) { retrievalComplete=false;continue; }
        const identity=line.id || line.name, previous=lines.get(identity);
        line.sourceQueries=[...new Set([...(previous?.sourceQueries||[]),query])];
        lines.set(identity,line);matched=true;
      }
      const total=Number(result.count);
      if(Number.isFinite(total)&&total>0)expected=total;
      if (Number.isFinite(total) && received>=total || !Number.isFinite(total) && buslines.length<100) break;
      if (page===10) retrievalComplete=false;
    }
    if (counts.line>=maxLineRequests) { retrievalComplete=false;queue.slice(index+1).forEach(name=>failedQueries.add(name));break; }
    if ((index+1)%30===0) await options.onProgress?.(`正在查询线路：${index+1}/${queue.length}。`);
  }
  if (!lines.size) throw new Error('未取得有效线路路径，保留原有数据。');
  // Line responses already include platforms; reuse them instead of another POI search.
  for (const line of lines.values()) for (const stop of line.via_stops||[]) {
    const id=`${stop.name}:${stop.location.lng},${stop.location.lat}`;
    const existing=stops.get(id);
    const names=new Set((existing?.address||'').split(/[;；]/).filter(Boolean));names.add(line.name);
    stops.set(id,{id:stop.id||'',name:stop.name,address:[...names].join(';'),location:stop.location});
  }
  const dataset=normalizeCityDataset({schemaVersion:1,city,scope:'city',coverage:'observed',capturedAt:new Date().toISOString(),
    retrievalComplete,filtered:false,stops:[...stops.values()],lines:[...lines.values()]});
  return { dataset, report:{counts,failedQueries:[...failedQueries],candidateNames:queue.length} };
}
