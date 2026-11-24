import type { PlannerPoint, PlannerStep } from './busPlanner';
import { distanceMeters } from './localTransit';

export async function estimateWalking(from: PlannerPoint['location'], to: PlannerPoint['location']): Promise<PlannerStep> {
  return {
    mode: 'WALK', instruction: '', distance: distanceMeters(from, to), time: 0,
    path: [from, to], from, to, walkingGeometry: 'straight',
  };
}

export function verifyWalking(AMap: any, from: PlannerPoint['location'], to: PlannerPoint['location'], timeoutMs: number) {
  return new Promise<PlannerStep | null>(resolve => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    try {
      new AMap.Walking().search(from, to, (status: string, result: any) => {
        clearTimeout(timeout);
        const routes = status === 'complete' && Array.isArray(result?.routes) ? result.routes : [];
        let best: PlannerStep | null = null;
        for (const route of routes) {
          const distance = Number(route.distance);
          if (!Number.isFinite(distance) || distance <= 0 || distance >= (best?.distance ?? Infinity) || !Array.isArray(route.steps)) continue;
          const path: PlannerPoint['location'][] = route.steps.flatMap((step: any) =>
            (Array.isArray(step.path) ? step.path : []).map((point: any) =>
              Array.isArray(point) ? [point[0], point[1]] : [point?.lng, point?.lat],
            ).filter((point: number[]) => point.every(Number.isFinite)),
          );
          if (path.length >= 2) best = { mode: 'WALK', path, distance, time: Number(route.time) || 0, instruction: '' };
        }
        resolve(best);
      });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}
