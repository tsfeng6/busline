import { discoverCityStops } from './discover-city-stops';
import { normalizeCityDataset, cityDataKey, type CityDataset } from '../src/utils/cityDataset';
import { getOperatingHours } from '../src/utils/operatingHours';
import { lineBaseIdentity, matchesLineQuery } from '../src/utils/lineIdentity';
import type { BusLine } from '../src/types';

type Options = {
  fetcher?: typeof fetch; wait?: () => Promise<void>; searchPages?: number; lineRequests?: number;
  seed?: CityDataset;
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
  const searchPages = Math.max(1, Math.min(1200, options.searchPages || 400));
  const maxLineRequests = Math.max(1, Math.min(3000, options.lineRequests || 1500));
  const counts = { district: 0, poi: 0, line: 0 };
  let retrievalComplete = true;
  const failedQueries = new Set<string>();
  const interruptions: {query:string;message:string}[] = [];
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
      const message=['10003','10044'].includes(code)
        ? `高德对应服务日调用额度已超限（${code}）；网站每日名额已解除，但需等待高德额度恢复或调整其配额。`
        : `数据源拒绝请求${code ? `（${code}）` : ''}，可能涉及权限、额度或请求限制。`;
      throw Object.assign(new Error(message),{fatal:true});
    }
    return result;
  };
  await options.onProgress?.('正在确认城市。');
  const districts = await request('/v3/config/district', { keywords: requestedCity, subdistrict:'2', extensions:'all' }, 'district');
  const district = array(districts.districts).find(item => text(item.name) && cityDataKey(item.name) === cityDataKey(requestedCity));
  const municipalities = new Set(['北京市','上海市','天津市','重庆市']);
  if (!district || !['city','district'].includes(district.level) && !municipalities.has(district.name)) throw new Error('无法确认该城市或地区，请检查名称。');
  const city = district.name;
  const scope = text(district.adcode) || city;
  const stops = new Map<string, CityDataset['stops'][number]>();
  const queries = new Map<string,string>();
  const queryScopes = new Map<string,Set<string>>();
  let discoveryComplete=false;
  await options.onProgress?.(`正在分区发现${city}公交站点（候选名称不是线路总数）。`);
  try {
    const discovered=await discoverCityStops(district,(path,params)=>request(path,params,'poi'),searchPages,options.onProgress);
    discoveryComplete=discovered.complete;
    if(!discovered.complete)retrievalComplete=false;
    for(const message of discovered.issues)interruptions.push({query:'站点发现',message});
    for(const poi of discovered.pois){
      const location=parseLocation(poi.location);
      if(!location||!text(poi.name)){retrievalComplete=false;continue;}
      const address=text(poi.address);
      stops.set(`${poi.name}:${location.lng},${location.lat}`,{id:text(poi.id),name:poi.name,address,location});
      for(const name of address.split(/[;；]/).map(part=>part.trim()).filter(Boolean)){
        const identity = lineBaseIdentity(name);
        if (!identity) continue;
        queries.set(identity,name);
        const adcode = text(poi.searchScope);
        if (adcode && adcode !== scope) {
          if (!queryScopes.has(identity)) queryScopes.set(identity,new Set());
          queryScopes.get(identity)!.add(adcode);
        }
      }
    }
  }catch(error:any){throw Object.assign(new Error(`站点发现失败：${error.message}`),{collectionReport:{city,counts,interruptions:[{query:'站点发现',message:error.message}]}});}
  const lines = new Map<string,BusLine>();
  const cachedQueries=new Set<string>();
  if(options.seed&&!options.seed.filtered&&!options.seed.retrievalComplete
    &&Date.now()-Date.parse(options.seed.capturedAt)<86400000
    &&Date.parse(options.seed.capturedAt)<=Date.now()+300000&&cityDataKey(options.seed.city)===cityDataKey(city)){
    for(const line of options.seed.lines){
      lines.set(line.id||line.name,line);
      for(const query of line.sourceQueries||[])cachedQueries.add(lineBaseIdentity(query));
    }
    for(const stop of options.seed.stops){
      const id=`${stop.name}:${stop.location.lng},${stop.location.lat}`;
      if(!stops.has(id))stops.set(id,stop);
      for(const name of stop.address.split(/[;；]/).map(part=>part.trim()).filter(Boolean))if(lineBaseIdentity(name))queries.set(lineBaseIdentity(name),name);
    }
  }
  if(!stops.size||!queries.size)throw new Error('没有取得可用的公交站点或线路，未发布空快照。');
  const cachedDirections=lines.size;
  const queue = [...queries.values()];
  await options.onProgress?.(`发现 ${stops.size} 个站点、${queue.length} 个候选名称；已复用 ${cachedDirections} 个线路方向。`);
  lineLoop: for (let index=0;index<queue.length;index++) {
    const query = queue[index].normalize('NFKC').replace(/[(#].*$/,'').trim();
    if (!query) { continue; }
    if(cachedQueries.has(lineBaseIdentity(query)))continue;
    let matched = false, exactMatch = false;
    const scopes = [scope, ...queryScopes.get(lineBaseIdentity(query)) || []];
    for (const searchScope of scopes) {
      if (exactMatch && searchScope !== scope) break;
      let received = 0, expected = Infinity;
      const seenPages = new Set<string>();
      for (let page=1;page<=10;page++) {
        if (counts.line>=maxLineRequests) { retrievalComplete=false;failedQueries.add(query);break; }
        let result:any;
        try { result=await request('/v3/bus/linename',{city:searchScope,keywords:query,offset:'100',page:String(page),extensions:'all'},'line'); }
        catch (error:any) {
          retrievalComplete=false;failedQueries.add(query);interruptions.push({query,message:error.message});
          if(error.fatal){queue.slice(index+1).forEach(name=>failedQueries.add(name));break lineLoop;}
          break;
        }
        const buslines=array(result.buslines);
        if (!buslines.length) { if (received && Number.isFinite(expected) && received<expected) { retrievalComplete=false;failedQueries.add(query); } break; }
        const pageKey=buslines.map(line=>line.id||line.name).join('|');
        if(seenPages.has(pageKey)){retrievalComplete=false;failedQueries.add(query);break;}
        seenPages.add(pageKey);
        received+=buslines.length;
        for (const info of buslines) {
          const exact = matchesLineQuery(query,text(info.name));
          if (searchScope !== scope && !exact) continue;
          const line=parseRestLine(info,city,query);
          if (!line) { retrievalComplete=false;continue; }
          const identity=line.id || line.name, previous=lines.get(identity);
          line.sourceQueries=[...new Set([...(previous?.sourceQueries||[]),query])];
          lines.set(identity,line);matched=true;exactMatch ||= exact;
        }
        const total=Number(result.count);
        if(Number.isFinite(total)&&total>0)expected=total;
        if (Number.isFinite(total) && received>=total || !Number.isFinite(total) && buslines.length<100) break;
        if (page===10) retrievalComplete=false;
      }
    }
    if (!matched || !exactMatch) { retrievalComplete=false;failedQueries.add(query); }
    if (counts.line>=maxLineRequests && index + 1 < queue.length) { retrievalComplete=false;queue.slice(index+1).forEach(name=>failedQueries.add(name));break; }
    if ((index+1)%30===0) await options.onProgress?.(`候选名称处理 ${index+1}/${queue.length}；已取得 ${lines.size} 个线路方向。`);
  }
  if (!retrievalComplete && options.seed && !options.seed.filtered && cityDataKey(options.seed.city) === cityDataKey(city)) {
    for (const line of options.seed.lines) if (!lines.has(line.id || line.name)) lines.set(line.id || line.name, line);
    for (const stop of options.seed.stops) {
      const id = `${stop.name}:${stop.location.lng},${stop.location.lat}`;
      if (!stops.has(id)) stops.set(id,stop);
    }
  }
  if (!lines.size) throw Object.assign(new Error(interruptions[0]?.message || '数据源未返回可用线路路径，保留原有数据。'),{collectionReport:{city,counts,failedQueries:[...failedQueries],interruptions,candidateNames:queue.length,discoveryComplete}});
  // Line responses already include platforms; reuse them instead of another POI search.
  for (const line of lines.values()) for (const stop of line.via_stops||[]) {
    const id=`${stop.name}:${stop.location.lng},${stop.location.lat}`;
    const existing=stops.get(id);
    const names=new Set((existing?.address||'').split(/[;；]/).filter(Boolean));names.add(line.name);
    stops.set(id,{id:stop.id||'',name:stop.name,address:[...names].join(';'),location:stop.location});
  }
  const dataset=normalizeCityDataset({schemaVersion:1,city,scope:'city',coverage:'observed',capturedAt:new Date().toISOString(),
    retrievalComplete,filtered:false,stops:[...stops.values()],lines:[...lines.values()]});
  return { dataset, report:{counts,failedQueries:[...failedQueries],interruptions,candidateNames:queue.length,discoveryComplete,cachedDirections,successfulDirections:lines.size,distinctLineNames:new Set([...lines.values()].map(line=>lineBaseIdentity(line.name))).size} };
}
