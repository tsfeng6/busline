import type { BusLine } from '../types';
import type { CityDataset } from './cityDataset';
import type { ContestRules } from './contestRules';
import { distanceMeters, radiusRing, regularGameRoute, routeName, type CountySeat, type Point } from './localTransit';
import { fullContestRouteName, isRouteEndpointAnnotation, routeAnnotations } from './contestRouteName';
import { createOfflineQuestion, shuffle, type OfflineQuestion } from './offlineGame';

// GCJ-02 district polygons from the DataV administrative atlas, limited to the
// configured central districts. Keep these available without a provider request.
import { contestDistricts } from '../data/contestDistricts';

type Ring = Point[];
type Polygon = Ring[];
export const hasContestDistricts = (city: string) => Object.hasOwn(contestDistricts, city);
export function contestDistrictPolygons(city: string): Polygon[] {
  return hasContestDistricts(city) ? contestDistricts[city] : [];
}

function contains(ring: Ring, [lng, lat]: Point) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index], [bx, by] = ring[previous];
    if ((ay > lat) !== (by > lat) && lng < (bx - ax) * (lat - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const regular = (name: string) => /^\d+路?(?:内环|外环|环线)?$/.test(routeName(name).normalize('NFKC'));
const loopDirection = /(?:内环|外环)$/;

function hasRouteVariant(name: string) {
  const normalized = name.normalize('NFKC');
  const annotations = routeAnnotations(normalized);
  // Published names append the origin and destination as direction metadata.
  if (!annotations || annotations.some(({ detail }) =>
    !/^(?:内环|外环|环线)$/.test(detail) && !isRouteEndpointAnnotation(detail))) return true;
  const label = routeName(normalized).replace(/\s+/g, '').replace(loopDirection, '').replace(/(\d[路线]?)环线$/, '$1');
  if (/(?:区间(?:快车?|慢车?|车|线)?|快车?|慢车?|支(?:线|路)?|短线|加班车?|延长线)(?:路)?$/.test(label)) return true;
  const numberedSuffix = label.match(/^(?:[A-Za-z\p{Script=Han}]{0,4})\d+(.*)$/u)?.[1];
  return numberedSuffix !== undefined && !/^(?:号?[路线])?$/.test(numberedSuffix);
}

function isRailRoute(name: string) {
  const label = routeName(name).normalize('NFKC').replace(/\s/g, '');
  if (/(?:接驳|公交|摆渡|替代|巴士)/.test(label)) return false;
  return /地铁|轨道交通|磁悬浮|轻轨|有轨电车|铁路|高铁|城际(?:列车|动车)|市域(?:快线|机场线|[A-Z]?\d+线|.*联络线)|^(?:机场联络线|金山线|怀密线|通密线|城市副中心线)$|^S\d+线|^\d+号线|^(?:G|D|C|K|T|Z)\d{2,5}(?:\/\d+)?$/i.test(label);
}
const routeStops = (line: BusLine) => (line.via_stops ?? []).flatMap(stop => {
  const point: Point = [stop.location?.lng, stop.location?.lat];
  const name = stop.name?.replace(/(?:公交车站|公交站)$/, '').trim();
  return name && point.every(Number.isFinite) ? [{ name, lngLat: point }] : [];
});
const options = (answer: string, candidates: string[], random: () => number) =>
  shuffle([answer, ...[...new Set(candidates.filter(name => name !== answer))].slice(0, 3)], random);

export function createCityContestQuestion(city: string, rules: ContestRules, candidates: string[], random = Math.random): OfflineQuestion {
  const choices = rules.fill ? [] : options(city, shuffle(candidates, random), random);
  if (!rules.fill && choices.length < 2) throw Error('题库暂无足够的选择题选项。');
  return { correctAnswer: city, targetCity: city, isFillIn: rules.fill, options: choices,
    promptText: '请根据公交线网猜城市。', showBasemap: false, showStops: false };
}

export function createNetworkContestQuestion(
  mode: 'city' | 'county', data: CityDataset, rules: ContestRules, candidates: string[], previous: string,
  seat?: CountySeat, random = Math.random,
): OfflineQuestion {
  const question = createOfflineQuestion(mode, 'hard', data, candidates, 1, previous, seat, random);
  if (!rules.fill && question.options.length < 2) throw Error('题库暂无足够的选择题选项。');
  return { ...question, isFillIn: rules.fill, options: rules.fill ? [] : question.options };
}

export function estimateUrbanDistrict(data: CityDataset): Polygon[] {
  type Cell = { count: number; lng: number; lat: number };
  const cells = new Map<string, Cell>();
  for (const { location } of data.stops) {
    if (!Number.isFinite(location?.lng) || !Number.isFinite(location?.lat)) continue;
    const { lng, lat } = location;
    const key = Math.floor(lng / 0.04) + ':' + Math.floor(lat / 0.04);
    const cell = cells.get(key) ?? { count: 0, lng: 0, lat: 0 };
    cell.count++;
    cell.lng += lng;
    cell.lat += lat;
    cells.set(key, cell);
  }
  const center = [...cells.values()].reduce<Cell | undefined>(
    (best, cell) => !best || cell.count > best.count ? cell : best, undefined);
  return center ? [[radiusRing([center.lng / center.count, center.lat / center.count], 12000)]] : [];
}

export function createLocalContestQuestion(
  mode: 'line' | 'station' | 'accessibility', data: CityDataset, rules: ContestRules, polygons: Polygon[], previous: string, random = Math.random,
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
  const unlimited = mode === 'line' && rules.range === 'unlimited';
  const answerName = unlimited ? fullContestRouteName : routeName;
  const drawableLines = data.lines.filter(line => line.path?.length >= 2);
  const entries = (unlimited ? drawableLines : drawableLines.filter(line =>
    !isRailRoute(line.name) && (mode !== 'line' || !hasRouteVariant(line.name))))
    .map(line => ({ line, stops: routeStops(line) }));
  const context = (rules.showNetworkContext || mode === 'accessibility') ? drawableLines.map(line => line.path) : undefined;
  const shared = { targetCity: data.city, promptText: '', showBasemap: rules.showBasemap, showStops: rules.showStops,
    isFillIn: rules.fill, contextPaths: context };
  if (mode === 'line') {
    const pool = entries.filter(entry => {
      const { line, stops } = entry;
      const inUrban = (stops.length >= 2 ? stops.map(stop => stop.lngLat) : line.path).every(urban);
      if (!inUrban && !rules.includeSuburbs) return false;
      if (unlimited || rules.range === 'unusual') return true;
      const normalized = line.name.normalize('NFKC');
      const label = routeName(normalized);
      if (loopDirection.test(label) || /\d[路线]?环线$/.test(label) || /\((?:内环|外环|环线)\)/.test(normalized)) return true;
      if (rules.range === 'niche') return /[0-9]/.test(label);
      if (inUrban && rules.range === 'urban') return regular(normalized);
      return regularGameRoute(normalized);
    });
    const picked = shuffle(pool.filter(entry => answerName(entry.line.name) !== previous), random)[0] ?? pool[0];
    if (!picked || (!rules.fill && new Set(pool.map(entry => answerName(entry.line.name))).size < 2)) throw Error('所选标签下暂无足够的线路。');
    const answer = answerName(picked.line.name);
    const middleStop = picked.stops[Math.floor(picked.stops.length / 2)];
    const target = middleStop?.lngLat ?? picked.line.path[Math.floor(picked.line.path.length / 2)];
    const names = rules.fill ? [] : rules.nearby
      ? pool.map(entry => ({ entry, distance: (entry.stops.length ? entry.stops.map(stop => stop.lngLat) : entry.line.path)
          .reduce((best, point) => Math.min(best, distanceMeters(point, target)), Infinity) }))
        .sort((a, b) => a.distance - b.distance).map(({ entry }) => entry)
      : shuffle(pool, random);
    return { ...shared, correctAnswer: answer, options: rules.fill ? [] : options(answer, names.map(entry => answerName(entry.line.name)), random),
      lineInfos: [picked.line], networkStops: picked.stops };
  }
  const stations = new Map<string, { name: string; lngLat: Point; routes: typeof entries }[]>();
  for (const entry of entries) for (const stop of entry.stops) {
    const group = stations.get(stop.name) ?? [];
    let station = group.find(other => distanceMeters(stop.lngLat, other.lngLat) <= 150);
    if (!station) { station = { ...stop, routes: [] }; group.push(station); stations.set(stop.name, group); }
    if (!station.routes.includes(entry)) station.routes.push(entry);
  }
  const all = [...stations.values()].flat();
  const scoped = rules.includeSuburbs ? all : all.filter(station => urban(station.lngLat));
  const candidates = scoped.filter(station =>
    new Set(station.routes.map(route => routeName(route.line.name))).size >= rules.minStationRoutes);
  const ordered = shuffle(candidates, random);
  for (const picked of [...ordered.filter(station => station.name !== previous), ...ordered.filter(station => station.name === previous)]) {
    const names = rules.fill ? [] : rules.nearby ? all
      .map(station => ({ name: station.name, distance: distanceMeters(station.lngLat, picked.lngLat) }))
      .filter(station => station.distance >= 700)
      .sort((a, b) => a.distance - b.distance).map(station => station.name)
      : shuffle(scoped, random).map(station => station.name);
    const choices = rules.fill ? [] : options(picked.name, names, random);
    if (!rules.fill && choices.length < (rules.nearby ? 4 : 2)) continue;
    return { ...shared, correctAnswer: picked.name, options: choices,
      targetPoint: { name: picked.name, lngLat: picked.lngLat }, fallbackCenter: picked.lngLat,
      lineInfos: mode === 'accessibility' ? picked.routes.map(entry => entry.line) : undefined,
      networkStops: mode === 'accessibility' && rules.showStops ? picked.routes.flatMap(entry => entry.stops) : undefined };
  }
  throw Error('所选标签下暂无足够的站点。');
}
