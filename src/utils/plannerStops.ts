import type { CityDataset } from './cityDataset';
import { isLocalBusLine, type PlannerPoint } from './busPlanner';

export type PlannerStation = PlannerPoint & { routes: string[] };
const normalize = (name: string) => name.normalize('NFKC').replace(/\s+/g, '').replace(/(?:公交站|公交车站)$/, '');

export function collectPlannerStations(data: CityDataset): PlannerStation[] {
  const stations = new Map<string, PlannerStation>();
  for (const line of data.lines) {
    if (!isLocalBusLine(line.name) || (line.via_stops?.length ?? 0) < 2) continue;
    const route = line.name.trim();
    for (const stop of line.via_stops ?? []) {
      if (typeof stop?.name !== 'string' || !stop.name.trim()) continue;
      const location: PlannerPoint['location'] = Array.isArray(stop.location)
        ? [stop.location[0], stop.location[1]] : [stop.location?.lng, stop.location?.lat];
      if (!location.every(Number.isFinite)) continue;
      const key = `${normalize(stop.name)}|${location.map(value => value.toFixed(6)).join(',')}`;
      let station = stations.get(key);
      if (!station) {
        station = { city: data.city, name: stop.name, location, routes: [] };
        stations.set(key, station);
      }
      if (!station.routes.includes(route)) station.routes.push(route);
    }
  }
  return [...stations.values()];
}

export function matchPlannerStations(stations: PlannerStation[], input: string, exactOnly = false): PlannerStation[] {
  const query = normalize(input);
  if (!query) return [];
  const exact: PlannerStation[] = [], prefixes: PlannerStation[] = [], partial: PlannerStation[] = [];
  for (const station of stations) {
    const name = normalize(station.name);
    if (name === query) exact.push(station);
    else if (!exactOnly && name.startsWith(query)) prefixes.push(station);
    else if (!exactOnly && name.includes(query)) partial.push(station);
  }
  return exact.concat(prefixes, partial);
}
