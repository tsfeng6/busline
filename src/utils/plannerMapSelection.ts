import type { PlannerMapSelection, PlannerPoint } from './busPlanner';
import { RouteRenderIndex } from './routeRenderIndex';

type Point = PlannerPoint['location'];
type Pixel = { x: number; y: number };

export function pickPlannerMapSelection(
  point: Point,
  pixel: Pixel,
  project: (point: Point) => Pixel,
  searchRadius: number,
  routes: RouteRenderIndex,
  markers: readonly { center: Point }[],
): PlannerMapSelection | null {
  let markerIndex = -1;
  let nearestMarker = 10;
  markers.forEach(({ center }, index) => {
    const target = project(center);
    const distance = Math.hypot(target.x - pixel.x, target.y - pixel.y);
    if (distance < nearestMarker) {
      nearestMarker = distance;
      markerIndex = index;
    }
  });
  if (markerIndex !== -1) return { kind: 'transfer', index: markerIndex };

  const distances = new Map<number, number>();
  for (const { lines, data } of routes.query(point, searchRadius)) {
    const from = project(data.offsetStart), to = project(data.offsetEnd);
    const dx = to.x - from.x, dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((pixel.x - from.x) * dx + (pixel.y - from.y) * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(pixel.x - from.x - t * dx, pixel.y - from.y - t * dy);
    if (distance > 7) continue;
    for (const name of lines) {
      const index = Number(name);
      distances.set(index, Math.min(distance, distances.get(index) ?? Infinity));
    }
  }
  if (!distances.size) return null;
  const nearest = Math.min(...distances.values());
  const indices = [...distances].filter(([, distance]) => distance <= nearest + 2).map(([index]) => index).sort((a, b) => a - b);
  return { kind: 'step', indices };
}
