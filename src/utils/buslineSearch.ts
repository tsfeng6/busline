import type { BusLine } from '../types';
import type { CityDataset } from './cityDataset';
import { lineBaseIdentity } from './lineIdentity';
import { distanceMeters, type Point } from './localTransit';

export type BuslineSearchResult =
  | { type: 'busline'; name: string; city?: string; line: BusLine }
  | { type: 'busstop'; name: string; city: string; location: Point; lines: Map<string, BusLine> };

const normalize = (name: string) => name.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const stationName = (name: string) => normalize(name).replace(/公交(?:车)?站$/, '');

export function searchBuslineData(
  query: string, city: string, datasets: Pick<CityDataset, 'lines' | 'stops'>[], userLines: BusLine[],
  isBlocked: (name: string) => boolean, center: Point,
): BuslineSearchResult[] {
  const text = normalize(query);
  if (!text) return [];
  const queryLine = text.includes('(') ? '' : lineBaseIdentity(query);
  const hasRouteSuffix = text.endsWith('路');
  const queryStop = stationName(query) || text;
  const matches = new Map<string, { result: BuslineSearchResult; rank: number; distance: number }>();
  const nearbyNames = new Map<string, Extract<BuslineSearchResult, { type: 'busstop' }>[]>();
  const seenLines = new Set<string>();

  const addStop = (name: string, location: { lng: number; lat: number }, line?: BusLine) => {
    if (!name || !Number.isFinite(location?.lng) || !Number.isFinite(location?.lat)) return;
    const label = stationName(name);
    if (!label.includes(queryStop)) return;
    const coords: Point = [location.lng, location.lat];
    const names = nearbyNames.get(label) ?? [];
    let candidate = names.find(stop => distanceMeters(stop.location, coords) <= 120);
    if (!candidate) {
      candidate = { type: 'busstop', name, city, location: coords, lines: new Map() };
      names.push(candidate);
      nearbyNames.set(label, names);
      matches.set('stop:' + label + ':' + coords.join(','), {
        result: candidate,
        rank: label === queryStop ? 1 : label.startsWith(queryStop) ? 3 : 5,
        distance: distanceMeters(coords, center),
      });
    }
    if (line) candidate.lines.set(line.name, line);
  };

  const addLine = (line: BusLine) => {
    if (!line.name || !line.path || line.path.length < 2 || isBlocked(line.name)) return;
    const id = (line.isUserSubmitted ? 'user:' : 'line:') + (line.id || line.name);
    if (seenLines.has(id)) return;
    seenLines.add(id);
    const identity = lineBaseIdentity(line.name);
    const name = normalize(line.name);
    if (name.includes(text) || (queryLine && (hasRouteSuffix ? identity === queryLine : identity.includes(queryLine)))) {
      matches.set(id, { result: { type: 'busline', name: line.name, city: line.city || city, line },
        rank: name === text || identity === queryLine ? 0
          : name.startsWith(text) || (queryLine && identity.startsWith(queryLine)) ? 2 : 4,
        distance: 0 });
    }
    if (line.via_stops?.length) {
      for (const stop of line.via_stops) addStop(stop.name, stop.location, line);
    } else {
      for (const stop of line.stops ?? []) {
        if (Array.isArray(stop.location)) addStop(stop.name, { lng: stop.location[0], lat: stop.location[1] }, line);
      }
    }
  };

  for (const dataset of datasets) {
    for (const stop of dataset.stops) addStop(stop.name, stop.location);
    for (const line of dataset.lines) addLine(line);
  }
  for (const line of userLines) addLine(line);
  return [...matches.values()].sort((a, b) => a.rank - b.rank || a.distance - b.distance)
    .slice(0, 12).map(match => match.result);
}
