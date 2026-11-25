import type { BusLine } from '../types';
import type { CityDataset } from './cityDataset';
import { lineBaseIdentity, matchesLineQuery } from './lineIdentity';
import { distanceMeters, type Point, type PublishedCity } from './localTransit';

const stationCache = new Map<string, { time: number; lines: string[] }>();
const cleanName = (name: string) => name.replace(/\(.*?\)|（.*?）/g, '').replace(/公交站/g, '').trim();

/** Cross-check POI address labels against the transit station dataset. */
export async function discoverStationLines(AMap: any, city: string, stops: any[], cancelled: () => boolean): Promise<string[]> {
  const unique = new Map<string, any>();
  for (const stop of stops) {
    if (!stop.name || !stop.location) continue;
    const key = `${cleanName(stop.name)}:${Number(stop.location.lng).toFixed(3)},${Number(stop.location.lat).toFixed(3)}`;
    if (!unique.has(key)) unique.set(key, stop);
  }
  const lines = new Set<string>();
  const entries = Array.from(unique.entries());
  for (let i = 0; i < entries.length && !cancelled(); i += 3) {
    await Promise.all(entries.slice(i, i + 3).map(async ([key, stop]) => {
      const cacheKey = `${city}:${key}`;
      const cached = stationCache.get(cacheKey);
      if (cached && Date.now() - cached.time < 300000) {
        cached.lines.forEach(name => lines.add(name));
        return;
      }
      const found = await new Promise<string[]>(resolve => {
        let settled = false;
        const finish = (names: string[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(names);
        };
        const timer = setTimeout(() => finish([]), 6000);
        try {
          new AMap.StationSearch({ city, pageSize: 50, pageIndex: 1 }).search(cleanName(stop.name), (status: string, result: any) => {
            if (cancelled() || status !== 'complete') { finish([]); return; }
            const names = new Set<string>();
            for (const station of result?.stationInfo || []) {
              if (!station.location || cleanName(station.name || '') !== cleanName(stop.name)) continue;
              const dx = (station.location.lng - stop.location.lng) * Math.cos(stop.location.lat * Math.PI / 180);
              const dy = station.location.lat - stop.location.lat;
              if (dx * dx + dy * dy > 0.003 ** 2) continue;
              for (const line of station.buslines || []) if (line.name) names.add(line.name);
            }
            finish([...names]);
          });
        } catch { finish([]); }
      });
      if (!cancelled() && found.length) {
        stationCache.set(cacheKey, { time: Date.now(), lines: found });
        found.forEach(name => lines.add(name));
      }
    }));
  }
  return cancelled() ? [] : [...lines];
}

/** Index the entire segment, including its endpoints, rather than its midpoint. */
export function segmentGridKeys(a: [number, number], b: [number, number], scale = 1000): string[] {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * scale * 2));
  const keys = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    keys.add(`${Math.floor((a[0] + (b[0] - a[0]) * t) * scale)},${Math.floor((a[1] + (b[1] - a[1]) * t) * scale)}`);
  }
  return [...keys];
}

export type StationCoverageDepth = 0 | 1 | 2;

type SavedStation = { name: string; location: Point };
type SavedRoute = { key: string; line: BusLine; stops: SavedStation[] };

const transferRadius = 100;

function stationKey(name: string) {
  return name.normalize('NFKC').replace(/\([^)]*\)/g, '').replace(/\s+/g, '').replace(/(?:公交车站|公交站)$/, '');
}

function indexSavedCity(data: CityDataset) {
  const stations = new Map<string, { location: Point; route: SavedRoute }[]>();
  const add = (stop: SavedStation, route: SavedRoute) => {
    const key = stationKey(stop.name);
    if (!key) return;
    const entries = stations.get(key) ?? [];
    entries.push({ location: stop.location, route });
    stations.set(key, entries);
  };
  const routesWithoutStops = new Map<string, SavedRoute[]>();

  for (const line of data.lines) {
    const stops: SavedStation[] = (line.via_stops ?? []).flatMap(stop => {
      const location: Point = Array.isArray(stop.location) ? stop.location : [stop.location?.lng, stop.location?.lat];
      return stop.name && location.every(Number.isFinite) ? [{ name: stop.name, location }] : [];
    });
    // Keep distinct directions and stop patterns, including across city borders.
    // A route without a stop sequence uses its saved direction identity instead.
    const key = JSON.stringify([line.name, stops.length > 0 ? stops.map(stop => [stationKey(stop.name), ...stop.location])
      : [data.city, line.id, line.path[0], line.path.at(-1)]]);
    const route = { key, line, stops };
    if (stops.length) stops.forEach(stop => add(stop, route));
    else {
      const identity = lineBaseIdentity(line.name);
      const entries = routesWithoutStops.get(identity) ?? [];
      entries.push(route);
      routesWithoutStops.set(identity, entries);
    }
  }

  if (routesWithoutStops.size) {
    for (const stop of data.stops) {
      for (const label of stop.address.split(/[;；]/)) {
        for (const route of routesWithoutStops.get(lineBaseIdentity(label)) ?? []) {
          if (matchesLineQuery(label, route.line.name)) add({ name: stop.name, location: [stop.location.lng, stop.location.lat] }, route);
        }
      }
    }
  }
  return stations;
}

/** Expand all saved directions one transfer layer at a time. City snapshot
 * bounds include any cross-boundary portions of their published routes. */
export async function expandSavedStationCoverage(
  origin: SavedStation & { city: string },
  depth: StationCoverageDepth,
  catalog: readonly Pick<PublishedCity, 'city' | 'bounds'>[],
  readCity: (city: string) => Promise<CityDataset | null>,
  cancelled: () => boolean,
  onLayer: (lines: BusLine[], depth: StationCoverageDepth) => Promise<void>,
) {
  const indexes = new Map<string, ReturnType<typeof indexSavedCity>>();
  const attempted = new Set<string>();
  const routes = new Set<string>();
  const visited = new Set<string>();
  let frontier: SavedStation[] = [origin];
  let unavailable = false;

  for (let layer = 0; layer <= depth && frontier.length && !cancelled(); layer++) {
    const cities = new Map<string, string>();
    const include = (city: string) => {
      const key = city.trim().replace(/市$/, '');
      if (key && key !== '全国' && !attempted.has(key)) cities.set(key, city);
    };
    if (layer === 0) include(origin.city);
    for (const { city, bounds: [west, south, east, north] } of catalog) {
      if (attempted.has(city.trim().replace(/市$/, ''))) continue;
      if (frontier.some(({ location: [lng, lat] }) => {
        if (lat < south - .001 || lat > north + .001) return false;
        const longitudePad = .001 / Math.max(.1, Math.cos(lat * Math.PI / 180));
        return lng >= west - longitudePad && lng <= east + longitudePad;
      })) include(city);
    }
    const pending = [...cities];
    for (let offset = 0; offset < pending.length && !cancelled(); offset += 2) {
      const batch = pending.slice(offset, offset + 2);
      const results = await Promise.all(batch.map(async ([key, city]) => ({
        key, data: await readCity(city).catch(() => null),
      })));
      if (cancelled()) break;
      for (const { key, data } of results) {
        attempted.add(key);
        if (data) indexes.set(key, indexSavedCity(data));
        else unavailable = true;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (cancelled()) break;

    const lines: BusLine[] = [], next: SavedStation[] = [];
    let yieldAt = performance.now() + 16;
    for (const stop of frontier) {
      if (performance.now() >= yieldAt) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (cancelled()) break;
        yieldAt = performance.now() + 16;
      }
      const name = stationKey(stop.name);
      for (const index of indexes.values()) {
        for (const { location, route } of index.get(name) ?? []) {
          if (routes.has(route.key) || distanceMeters(stop.location, location) > transferRadius) continue;
          routes.add(route.key);
          lines.push(route.line);
          if (layer === depth) continue;
          for (const station of route.stops) {
            const key = JSON.stringify([stationKey(station.name), ...station.location]);
            if (visited.has(key)) continue;
            visited.add(key);
            next.push(station);
          }
        }
      }
    }
    if (cancelled()) break;
    await onLayer(lines, layer as StationCoverageDepth);
    frontier = next;
  }

  return { count: routes.size, unavailable };
}
