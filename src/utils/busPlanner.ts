import { distanceMeters } from './localTransit';

export interface PlannerPoint { city: string; name: string; location: [number, number] }
export interface PlannerStep { mode: 'BUS' | 'WALK'; instruction: string; distance: number; time: number; path: [number, number][]; from?: PlannerPoint['location']; to?: PlannerPoint['location'] }
export interface BusPlan { steps: PlannerStep[]; time: number; distance: number; walking: number; buses: number }
const forbidden = /地铁|轻轨|有轨电车|磁悬浮|单轨|高铁|动车|火车|铁路|机场|航空|长途|客运班线|旅游|定制|大巴/;
export const isLocalBusLine = (name: string) => Boolean(name) && !forbidden.test(name.split(/[（(]/, 1)[0]);
export function normalizeBusPlan(plan: any, maxWalking: number): BusPlan | null {
  if (!Array.isArray(plan?.segments) || !plan.segments.length || Number(plan.railway_distance || 0) > 0 || Number(plan.taxi_distance || 0) > 0) return null;
  const steps: PlannerStep[] = [];
  for (const segment of plan.segments) {
    if (!['BUS', 'WALK'].includes(segment.transit_mode)) return null;
    const transit = segment.transit || {};
    const mode = segment.transit_mode as 'BUS' | 'WALK';
    const distance = Number(transit.distance ?? segment.distance ?? 0);
    if (!Number.isFinite(distance) || distance < 0) return null;
    const lines = Array.isArray(transit.lines) ? transit.lines : [];
    if (mode === 'BUS' && (!lines.length || lines.some((line: any) => !line.name || forbidden.test(`${line.name} ${line.type || ''}`)))) return null;
    const path = (Array.isArray(transit.path) ? transit.path : []).map((point: any) =>
      Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point.lng ?? point.getLng?.()), Number(point.lat ?? point.getLat?.())]
    ).filter((point: number[]) => point.every(Number.isFinite)) as [number, number][];
    const on = transit.on_station?.name || '', off = transit.off_station?.name || '';
    const instruction = mode === 'WALK' ? `步行 ${Math.round(distance)} 米${transit.destination?.name ? `至${transit.destination.name}` : ''}`
      : `${lines.map((line: any) => line.name).join(' / ')}：${on || '上车站待确认'} → ${off || '下车站待确认'}`;
    steps.push({ mode, instruction, distance, time: Number(transit.time || 0), path });
  }
  const walking = steps.filter(step => step.mode === 'WALK').reduce((sum, step) => sum + step.distance, 0);
  const walkingTotal = Math.max(walking, Number(plan.walking_distance || 0));
  if (!Number.isFinite(walkingTotal) || walkingTotal > maxWalking || !steps.some(step => step.mode === 'BUS')) return null;
  return { steps, walking: walkingTotal, time: Number(plan.time || 0), distance: Number(plan.distance || 0), buses: steps.filter(step => step.mode === 'BUS').length };
}
export function plannerDistance(meters: number): string { return meters >= 1000 ? `${(meters / 1000).toFixed(1)}公里` : `${Math.round(meters)}米`; }
export function plannerDuration(seconds: number): string { const minutes = Math.ceil(seconds / 60); return `${Math.floor(minutes / 60)}小时${minutes % 60}分`; }

export function plannerTransferPoints(steps: readonly PlannerStep[]): PlannerPoint['location'][] {
  const points: PlannerPoint['location'][] = [];
  for (let index = 1; index < steps.length; index++) {
    const previous = steps[index - 1], next = steps[index];
    if (previous.mode === 'WALK' && next.mode === 'WALK') continue;
    for (const point of [previous.to ?? previous.path.at(-1), next.from ?? next.path[0]]) {
      if (point && point.every(Number.isFinite) && !points.some(existing => distanceMeters(existing, point) < 12)) points.push(point);
    }
  }
  return points;
}

export function plannerBusSequence(plan: BusPlan): string {
  return plan.steps.filter(step => step.mode === 'BUS').map(step =>
    step.instruction.split(/[：:（(]/, 1)[0].trim()).join(' → ');
}

export function plannerPlanText(plan: BusPlan, points: readonly PlannerPoint[]): string {
  return [
    points.map(point => `${point.city} · ${point.name}`).join(' → '),
    `全程约 ${plannerDistance(plan.distance)} · 换乘 ${Math.max(0, plan.buses - 1)} 次 · 步行 ${plannerDistance(plan.walking)}`,
    ...plan.steps.map((step, index) => `${index + 1}. ${step.instruction}（${plannerDistance(step.distance)}）`),
  ].filter(Boolean).join('\n');
}
