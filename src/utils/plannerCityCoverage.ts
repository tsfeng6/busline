import type { PlannerPoint } from './busPlanner';
import { distanceMeters, type Point, type PublishedCity } from './localTransit';

export function plannerCorridorWidths(from: PlannerPoint, to: PlannerPoint): number[] {
  const wide = Math.ceil(distanceMeters(from.location, to.location) * .15 / 1000);
  return wide > 100 ? [30, 100, wide] : [30, 100];
}

export const plannerCityKey = (name: string) => name.trim().replace(/市$/, '');

export function firstBoundaryCrossing(from: Point, to: Point, rings: readonly Point[][]): number {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  let first = Infinity;
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[j], [nextX, nextY] = ring[i];
      const sx = nextX - x, sy = nextY - y;
      if ((y > from[1]) !== (nextY > from[1]) && from[0] < x + sx * (from[1] - y) / sy) inside = !inside;
      const determinant = dx * sy - dy * sx;
      if (Math.abs(determinant) < 1e-12) continue;
      const ox = x - from[0], oy = y - from[1];
      const t = (ox * sy - oy * sx) / determinant;
      const u = (ox * dy - oy * dx) / determinant;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) first = Math.min(first, t);
    }
    if (inside) return 0;
  }
  return first;
}

const cachedBoundaries = new Map<string, Point[][]>();

export async function prioritizePlannerCities(
  AMap: any, cities: readonly string[], from: PlannerPoint, to: PlannerPoint, cancelled: () => boolean,
): Promise<string[]> {
  if (!AMap.DistrictSearch || plannerCityKey(from.city) === plannerCityKey(to.city)) return [...cities];
  const deadline = Date.now() + 4_000;
  let next = 0;
  const priorities = new Map<string, number>([[plannerCityKey(from.city), 0], [plannerCityKey(to.city), 1]]);
  const lookup = async () => {
    while (next < cities.length && !cancelled()) {
      const city = cities[next++];
      const key = plannerCityKey(city);
      if (priorities.has(key)) continue;
      let rings = cachedBoundaries.get(key);
      if (!rings) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) continue;
        rings = await new Promise<Point[][]>(resolve => {
          const timer = setTimeout(() => resolve([]), Math.min(1_500, remaining));
          try {
            new AMap.DistrictSearch({ subdistrict: 0, extensions: 'all' }).search(city, (status: string, result: any) => {
              clearTimeout(timer);
              const district = status === 'complete' && Array.isArray(result?.districtList)
                ? result.districtList.find((item: any) => typeof item?.name === 'string' && plannerCityKey(item.name) === key)
                : undefined;
              const boundaries = (Array.isArray(district?.boundaries) ? district.boundaries : []).flatMap((ring: any) => {
                if (!Array.isArray(ring)) return [];
                const points: Point[] = ring.map((point): Point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point?.lng), Number(point?.lat)])
                  .filter(point => point.every(Number.isFinite));
                return points.length >= 3 ? [points] : [];
              });
              if (boundaries.length) cachedBoundaries.set(key, boundaries);
              resolve(boundaries);
            });
          } catch { clearTimeout(timer); resolve([]); }
        });
      }
      priorities.set(key, firstBoundaryCrossing(from.location, to.location, rings));
    }
  };
  await Promise.all([lookup(), lookup()]);
  return [...cities].sort((a, b) =>
    (priorities.get(plannerCityKey(a)) ?? Infinity) - (priorities.get(plannerCityKey(b)) ?? Infinity));
}

// Snapshot bounds describe the routes themselves, including portions beyond
// the city or province that published them.
export function plannerCorridorCities(
  catalog: readonly PublishedCity[], from: PlannerPoint, to: PlannerPoint, radiusKm: number,
): string[] {
  const latitudePad = radiusKm / 110;
  const latitude = Math.min(89, Math.max(Math.abs(from.location[1]), Math.abs(to.location[1])) + latitudePad);
  const longitudePad = latitudePad / Math.cos(latitude * Math.PI / 180);
  const pad = [longitudePad, latitudePad];
  const cities = new Map([from, to].map(stop => [plannerCityKey(stop.city), stop.city]));
  for (const { city, bounds } of catalog) {
    const key = plannerCityKey(city);
    if (cities.has(key)) continue;
    let enter = 0;
    let exit = 1;
    for (let axis = 0; axis < 2; axis++) {
      const start = from.location[axis];
      const delta = to.location[axis] - start;
      const lower = bounds[axis] - pad[axis], upper = bounds[axis + 2] + pad[axis];
      if (delta === 0) {
        if (start < lower || start > upper) enter = Infinity;
        continue;
      }
      const a = (lower - start) / delta, b = (upper - start) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    if (enter <= exit) cities.set(key, city);
  }
  return [...cities.values()];
}
