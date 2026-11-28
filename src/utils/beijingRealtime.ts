export const BEIJING_PILOT_ROUTES = {
  '110100015388': 'F28 中国社会科学院大学（良乡） → 周庄村南',
  '110100016246': 'F28 周庄村南 → 中国社会科学院大学（良乡）',
  '900000220963': 'F86 官道西 → 悦都新苑',
  '900000220962': 'F86 悦都新苑 → 官道西',
} as const;

export type BeijingPilotRoute = keyof typeof BEIJING_PILOT_ROUTES;
export const isBeijingPilotRoute = (id: string): id is BeijingPilotRoute => Object.hasOwn(BEIJING_PILOT_ROUTES, id);
export const VEHICLE_MAX_AGE_MS = 90_000;
export const VEHICLE_POLL_MS = 20_000;

export type LiveVehicle = { id: string; lng: number; lat: number; observedAt: number };
export type BeijingPilotResponse =
  | { state: 'unconfigured' | 'unavailable' }
  | { state: 'ready'; source: string; vehicles: LiveVehicle[] };

export function isFreshVehicle(observedAt: number, now = Date.now()) {
  return Number.isFinite(observedAt) && observedAt >= now - VEHICLE_MAX_AGE_MS && observedAt <= now + 10_000;
}
