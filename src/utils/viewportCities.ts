export type Bounds = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
export interface BoundedCity { city: string; bounds: Bounds; }

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

export function expandBounds(bounds: Bounds, ratio: number): Bounds {
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];
  const dx = width * ratio;
  const dy = height * ratio;
  return [bounds[0] - dx, bounds[1] - dy, bounds[2] + dx, bounds[3] + dy];
}

export function citiesInViewport(cities: BoundedCity[], bounds: Bounds): string[] {
  return cities.filter(city => boundsIntersect(city.bounds, bounds)).map(city => city.city);
}

export function cityBoundsOf(cities: BoundedCity[], city: string): Bounds | null {
  return cities.find(item => item.city === city)?.bounds ?? null;
}

/**
 * Bounds-proximity adjacency (prototype). Expanding a city's own bounds by `ratio`
 * and testing intersection approximates "接壤" but is NOT administrative topology:
 * it cannot distinguish sea crossings (香港/澳门/台湾县市会因 bounds 相邻而被判为邻近)。
 * Exact polygon-based adjacency is deferred until boundary data is available.
 */
export function neighborsOf(city: string, cities: BoundedCity[], ratio = 0.05): string[] {
  const target = cities.find(item => item.city === city);
  if (!target) return [];
  const padded = expandBounds(target.bounds, ratio);
  return cities
    .filter(item => item.city !== city && boundsIntersect(item.bounds, padded))
    .map(item => item.city);
}
