import type { PlannerPoint } from './busPlanner';
import type { PublishedCity } from './localTransit';

export const PLANNER_CORRIDOR_KM = [30, 100] as const;

export const plannerCityKey = (name: string) => name.trim().replace(/市$/, '');

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
