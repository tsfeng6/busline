import type { BusLine } from '../../src/types';
import type { CityDataset } from '../../src/utils/cityDataset';
import type { ContestRules } from '../../src/utils/contestRules';
import { distanceMeters, routeName, type Point } from '../../src/utils/localTransit';
import { shuffle, type OfflineQuestion } from '../../src/utils/offlineGame';

type Ring = Point[];
type Polygon = Ring[];
const districts: Record<string, { code: string; names: string[] }> = {
  北京市: { code: '110000', names: ['东城', '西城', '海淀', '朝阳', '丰台', '石景山'] },
  上海市: { code: '310000', names: ['黄浦', '静安', '徐汇', '长宁', '普陀', '虹口', '杨浦'] },
};
const districtReads = new Map<string, Promise<Polygon[]>>();

export function loadContestDistricts(city: string, read: typeof fetch): Promise<Polygon[]> {
  const district = districts[city];
  if (!district) throw Error('此城市尚未开放竞赛。');
  let pending = districtReads.get(city);
  if (!pending) {
    pending = (async () => {
      const response = await read(`https://geo.datav.aliyun.com/areas_v3/bound/${district.code}_full.json`,
        { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error('区划数据暂时不可用。');
      const { features } = await response.json();
      return district.names.flatMap(name => {
        const geometry = features.find((feature: any) => feature.properties?.name === name + '区')?.geometry;
        if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !geometry.coordinates?.length) throw Error('中心城区边界不完整。');
        return (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as Polygon[];
      });
    })().catch(error => { districtReads.delete(city); throw error; });
    districtReads.set(city, pending);
  }
  return pending;
}

function contains(ring: Ring, [lng, lat]: Point) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index], [bx, by] = ring[previous];
    if ((ay > lat) !== (by > lat) && lng < (bx - ax) * (lat - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const regular = (name: string) => /^\d+路?(?:内环|外环)?$/.test(routeName(name).normalize('NFKC'));
const strange = (name: string) => !/\d/.test(routeName(name)) || /旅游|观光|定制|通勤|机场|假日|专乘/.test(routeName(name));
const routeStops = (line: BusLine) => (line.via_stops ?? []).flatMap(stop => {
  const point: Point = [stop.location?.lng, stop.location?.lat];
  const name = stop.name?.replace(/(?:公交车站|公交站)$/, '').trim();
  return name && point.every(Number.isFinite) ? [{ name, lngLat: point }] : [];
});
const options = (answer: string, candidates: string[], random: () => number) =>
  shuffle([answer, ...[...new Set(candidates.filter(name => name !== answer))].slice(0, 3)], random);

export function createLocalContestQuestion(
  mode: 'line' | 'station', data: CityDataset, rules: ContestRules, polygons: Polygon[], previous: string, random: () => number,
): OfflineQuestion {
  const checks = polygons.map(([ring, ...holes]) => {
    const bounds = ring.reduce(([w,s,e,n], [x,y]) => [Math.min(w,x), Math.min(s,y), Math.max(e,x), Math.max(n,y)],
      [Infinity,Infinity,-Infinity,-Infinity]);
    return { ring, holes, bounds };
  });
  const urbanCache = new Map<string, boolean>();
  const urban = (point: Point) => {
    const key = point.join(',');
    let included = urbanCache.get(key);
    if (included === undefined) {
      included = checks.some(({ ring, holes, bounds: [w,s,e,n] }) =>
        point[0] >= w && point[0] <= e && point[1] >= s && point[1] <= n
        && contains(ring, point) && !holes.some(hole => contains(hole, point)));
      urbanCache.set(key, included);
    }
    return included;
  };
  const unrestricted = rules.range === 'unusual';
  const citywide = rules.range === 'all-city' || unrestricted;
  const entries = data.lines.filter(line => line.path?.length >= 2).map(line => ({ line, stops: routeStops(line) }));
  const eligible = entries.filter(({ line }) => mode === 'station' || rules.range === 'urban' ? regular(line.name)
    : unrestricted || !strange(line.name));
  const context = rules.showBasemap ? entries.map(({ line }) => line.path) : undefined;
  const shared = { targetCity: data.city, promptText: '', showBasemap: rules.showBasemap, showStops: rules.showStops,
    isFillIn: rules.fill, contextPaths: context };
  if (mode === 'line') {
    const pool = eligible.filter(entry => unrestricted ||
      (entry.stops.length >= 2 && (citywide || entry.stops.every(stop => urban(stop.lngLat)))));
    const picked = shuffle(pool.filter(entry => routeName(entry.line.name) !== previous), random)[0] ?? pool[0];
    if (!picked || (!rules.fill && new Set(pool.map(entry => routeName(entry.line.name))).size < 2)) throw Error('所选标签下暂无足够的计分线路。');
    const answer = routeName(picked.line.name);
    const middleStop = picked.stops[Math.floor(picked.stops.length / 2)];
    const target = middleStop?.lngLat ?? picked.line.path[Math.floor(picked.line.path.length / 2)];
    const names = rules.fill ? [] : rules.nearby
      ? pool.map(entry => ({ entry, distance: (entry.stops.length ? entry.stops.map(stop => stop.lngLat) : entry.line.path)
          .reduce((best, point) => Math.min(best, distanceMeters(point, target)), Infinity) }))
        .sort((a, b) => a.distance - b.distance).map(({ entry }) => entry)
      : shuffle(pool, random);
    return { ...shared, correctAnswer: answer, options: rules.fill ? [] : options(answer, names.map(entry => routeName(entry.line.name)), random),
      lineInfos: [picked.line], networkStops: picked.stops };
  }
  const stations = new Map<string, { name: string; lngLat: Point; routes: typeof eligible }[]>();
  for (const entry of eligible) for (const stop of entry.stops) {
    if (!citywide && !urban(stop.lngLat)) continue;
    const group = stations.get(stop.name) ?? [];
    let station = group.find(other => distanceMeters(stop.lngLat, other.lngLat) <= 150);
    if (!station) { station = { ...stop, routes: [] }; group.push(station); stations.set(stop.name, group); }
    if (!station.routes.includes(entry)) station.routes.push(entry);
  }
  const all = [...stations.values()].flat();
  const candidates = all.filter(station => new Set(station.routes.map(route => routeName(route.line.name))).size >= 2);
  const picked = shuffle(candidates.filter(station => station.name !== previous), random)[0] ?? candidates[0];
  if (!picked || (!rules.fill && stations.size < 2)) throw Error('所选标签下暂无足够的计分站点。');
  const names = rules.fill ? [] : rules.nearby ? [...all].sort((a,b) => distanceMeters(a.lngLat,picked.lngLat)-distanceMeters(b.lngLat,picked.lngLat)) : shuffle(all,random);
  return { ...shared, correctAnswer: picked.name, options: rules.fill ? [] : options(picked.name, names.map(station => station.name), random),
    targetPoint: { name: picked.name, lngLat: picked.lngLat }, fallbackCenter: picked.lngLat,
    lineInfos: picked.routes.map(entry => entry.line), networkStops: picked.routes.flatMap(entry => entry.stops) };
}
