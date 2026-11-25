import { distanceMeters } from './localTransit';

export interface PlannerPoint { city: string; name: string; location: [number, number] }
export interface PlannerStep { mode: 'BUS' | 'WALK'; instruction: string; distance: number; time: number; path: [number, number][]; from?: PlannerPoint['location']; to?: PlannerPoint['location']; fromName?: string; toName?: string; walkingGeometry?: 'straight' }
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
export function estimatePlannerBusSeconds(distance: number, name: string, city = '', intervals = 0): number {
  const service = name.split(/[（(]/, 1)[0];
  const speed = /高速/.test(service) ? (/上海/.test(city) ? 50 : 44)
    : /BRT|快速公交|奉浦快线/i.test(service) ? 25
    : /中运量/.test(service) || (/上海/.test(city) && /^71路(?:区间)?$/.test(service)) ? 20
    : /郊区|郊线/.test(service) || (intervals > 0 && distance / intervals >= 1200) ? 30
    : /上海/.test(city) ? 18 : 20;
  return distance * 3.6 / speed;
}

export function plannerMinimumDuration(plan: BusPlan): string {
  const busSeconds = plan.steps.reduce((total, step) =>
    total + (step.mode === 'BUS' ? step.time || estimatePlannerBusSeconds(step.distance, step.instruction.split(/[：:]/, 1)[0]) : 0), 0);
  const minutes = Math.ceil((busSeconds + plan.walking * 3.6 / 4.5) / 60);
  const hours = Math.floor(minutes / 60);
  return `至少需要${hours ? `${hours}小时` : ''}${minutes % 60}分钟`;
}

export function plannerLineExcluded(name: string, keywords: readonly string[]): boolean {
  if (!keywords.length) return false;
  const normalized = name.normalize('NFKC').toLowerCase();
  return keywords.some(keyword => keyword && normalized.includes(keyword.normalize('NFKC').toLowerCase()));
}

export type PlannerMapSelection = ({ kind: 'step'; indices: number[] } | { kind: 'transfer'; index: number }) & { fromDetails?: boolean };

export function samePlannerMapSelection(a: PlannerMapSelection | null, b: PlannerMapSelection): boolean {
  if (a?.kind === 'transfer' && b.kind === 'transfer') return a.index === b.index;
  return a?.kind === 'step' && b.kind === 'step' && a.indices.length === b.indices.length
    && a.indices.every((index, at) => index === b.indices[at]);
}

export type PlannerTransferChange = { stepIndex: number; label: string; stopName?: string };

export function plannerTransferMarkers(steps: readonly PlannerStep[]) {
  const markers: { center: PlannerPoint['location']; changes: PlannerTransferChange[] }[] = [];
  for (let index = 1; index < steps.length; index++) {
    const previous = steps[index - 1], next = steps[index];
    if (previous.mode === 'WALK' && next.mode === 'WALK') continue;
    const from = previous.to ?? previous.path.at(-1), to = next.from ?? next.path[0];
    const add = (point: PlannerPoint['location'] | undefined, label: string, stopName?: string) => {
      if (!point?.every(Number.isFinite)) return;
      const change: PlannerTransferChange = { stepIndex: index, label };
      if (stopName) change.stopName = stopName;
      const marker = markers.find(item => distanceMeters(item.center, point) < 12);
      if (marker) marker.changes.push(change);
      else markers.push({ center: point, changes: [change] });
    };
    if (from && to && distanceMeters(from, to) < 12) {
      add(from, previous.mode === next.mode ? '同站换乘' : next.mode === 'BUS' ? '步行后上车' : '下车后步行', previous.toName || next.fromName);
    } else {
      add(from, previous.mode === 'BUS' ? '下车' : '步行结束', previous.toName);
      add(to, next.mode === 'BUS' ? '上车' : '开始步行', next.fromName);
    }
  }
  return markers;
}

export function plannerTransferPoints(steps: readonly PlannerStep[]): PlannerPoint['location'][] {
  return plannerTransferMarkers(steps).map(marker => marker.center);
}

export function plannerBusSequence(plan: BusPlan): string {
  return plan.steps.filter(step => step.mode === 'BUS').map(step =>
    step.instruction.split(/[：:（(]/, 1)[0].trim()).join(' → ');
}

export function plannerWalkingLabel(plan: BusPlan): string {
  return plan.steps.some(step => step.walkingGeometry === 'straight') ? '步行直线估算' : '步行';
}

export function plannerPlanText(plan: BusPlan, points: readonly PlannerPoint[]): string {
  return [
    points.map(point => `${point.city} · ${point.name}`).join(' → '),
    `全程约 ${plannerDistance(plan.distance)} · 换乘 ${Math.max(0, plan.buses - 1)} 次 · ${plannerWalkingLabel(plan)} ${plannerDistance(plan.walking)}`,
    ...plan.steps.map((step, index) => `${index + 1}. ${step.instruction}（${plannerDistance(step.distance)}）`),
  ].filter(Boolean).join('\n');
}
