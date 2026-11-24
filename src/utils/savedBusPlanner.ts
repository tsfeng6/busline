import type { BusLine } from '../types';
import type { BusPlan, PlannerPoint, PlannerStep } from './busPlanner';
import { isLocalBusLine } from './busPlanner';
import { distanceMeters, type Point } from './localTransit';

export const MAX_SAVED_BUS_LEGS = 8;
export const MAX_TRANSFER_RADIUS = 800;
const gridSize = .01;
const BUS_DISTANCE_WEIGHT = .22;
const TRANSFER_COST = 450;

type Stop = { name: string; point: Point; key: string };
type Ride = { route: number; line: BusLine; stops: Stop[]; from: number; to: number };
type Label = { walk: number; busDistance: number; rides: Ride[] };
type Walk = { from: Stop; to: Stop };
type Candidate = Label & { walks: Walk[] };
type WalkResults = Map<string, PlannerStep | null>;
type TransferLink = { stop: Stop; distance: number };

function stopAt(name: string, point: Point): Stop {
  return { name, point, key: point.map(value => value.toFixed(6)).join(',') };
}

function walkKey({ from, to }: Walk) { return from.key + '>' + to.key; }

function gridKey(x: number, y: number) { return x + ':' + y; }

export function paretoBusPlans(plans: BusPlan[]): BusPlan[] {
  const sorted = [...plans].sort((a, b) => transfers(a) - transfers(b) || a.walking - b.walking || a.distance - b.distance);
  const recommended = sorted.reduce<BusPlan | undefined>((best, plan) =>
    !best || busPlanScore(plan) < busPlanScore(best) ? plan : best, undefined);
  let bestWalking = Infinity;
  return sorted.filter(plan => {
    if (plan.walking >= bestWalking) return plan === recommended;
    bestWalking = Math.min(bestWalking, plan.walking);
    return true;
  });
}

export function transfers(plan: BusPlan) { return Math.max(0, plan.buses - 1); }

export function busPlanScore(plan: BusPlan) {
  return plan.walking + transfers(plan) * TRANSFER_COST + Math.max(0, plan.distance - plan.walking) * BUS_DISTANCE_WEIGHT;
}

export function recommendedBusPlans(plans: BusPlan[]): BusPlan[] {
  const sorted = [...plans].sort((a, b) => busPlanScore(a) - busPlanScore(b));
  const best = sorted[0];
  if (!best) return sorted;
  return sorted.filter(plan => !(plan.distance > best.distance * 2
    && plan.distance - best.distance >= 5000
    && transfers(plan) >= transfers(best) - 1
    && best.walking - plan.walking <= 750));
}

function indexSavedNetwork(lines: readonly BusLine[]) {
  const platforms = new Map<string, Stop>();
  const routes: { line: BusLine; stops: Stop[]; distances: number[] }[] = [];
  const routesByPlatform = new Map<string, number[]>();
  const routeKeys = new Set<string>();
  for (const line of lines) {
    if (!isLocalBusLine(line.name) || !line.via_stops || line.via_stops.length < 2) continue;
    const stops = line.via_stops.flatMap(stop => {
      const point: Point = Array.isArray(stop?.location) ? stop.location as Point
        : [stop?.location?.lng, stop?.location?.lat];
      return stop?.name && point.every(Number.isFinite) ? [stopAt(stop.name, point)] : [];
    });
    if (stops.length !== line.via_stops.length) continue;
    // The same service can appear in multiple city snapshots. Keep distinct
    // directions and stopping patterns, even if the route name is shared.
    const routeKey = JSON.stringify([line.name, stops.map(stop => [stop.key, stop.name])]);
    if (routeKeys.has(routeKey)) continue;
    routeKeys.add(routeKey);
    for (const stop of stops) {
      platforms.set(stop.key, stop);
      const servingRoutes = routesByPlatform.get(stop.key) ?? [];
      if (servingRoutes.at(-1) !== routes.length) servingRoutes.push(routes.length);
      routesByPlatform.set(stop.key, servingRoutes);
    }
    let distance = 0;
    const distances = stops.map((stop, index) => {
      if (index) distance += distanceMeters(stops[index - 1].point, stop.point);
      return distance;
    });
    routes.push({ line, stops, distances });
  }
  const grid = new Map<string, Stop[]>();
  for (const stop of platforms.values()) {
    const key = gridKey(Math.floor(stop.point[0] / gridSize), Math.floor(stop.point[1] / gridSize));
    const cell = grid.get(key) ?? [];
    cell.push(stop);
    grid.set(key, cell);
  }
  const links = new Map<string, TransferLink[]>();
  const transfersFrom = (stop: Stop) => {
    const cached = links.get(stop.key);
    if (cached) return cached;
    const nearby: TransferLink[] = [];
    const x = Math.floor(stop.point[0] / gridSize), y = Math.floor(stop.point[1] / gridSize);
    const horizontalCells = Math.ceil(MAX_TRANSFER_RADIUS / (111000 * gridSize * Math.max(.1, Math.cos(stop.point[1] * Math.PI / 180))));
    for (let dx = -horizontalCells; dx <= horizontalCells; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const next of grid.get(gridKey(x + dx, y + dy)) ?? []) {
          const distance = distanceMeters(stop.point, next.point);
          if (distance <= MAX_TRANSFER_RADIUS) nearby.push({ stop: next, distance });
        }
      }
    }
    links.set(stop.key, nearby);
    return nearby;
  };
  return { platforms, routes, routesByPlatform, transfersFrom };
}

export function savedBusCandidates(
  lines: readonly BusLine[], origin: PlannerPoint, destination: PlannerPoint,
  walkingLimit: number, verified: WalkResults, maxLegs = MAX_SAVED_BUS_LEGS,
): Candidate[] {
  return findCandidates(indexSavedNetwork(lines), origin, destination, walkingLimit, verified, maxLegs);
}

// Each round scans only lines with a reachable boarding platform.
function findCandidates(
  { platforms, routes, routesByPlatform, transfersFrom }: ReturnType<typeof indexSavedNetwork>,
  origin: PlannerPoint, destination: PlannerPoint, walkingLimit: number, verified: WalkResults,
  maxLegs = MAX_SAVED_BUS_LEGS, busWeight = 0,
): Candidate[] {
  const start = stopAt(origin.name, origin.location);
  const end = stopAt(destination.name, destination.location);
  const walkCost = (from: Stop, to: Stop, directDistance?: number) => {
    if (from.key === to.key) return 0;
    const result = verified.get(walkKey({ from, to }));
    return result === null ? Infinity : result?.distance ?? directDistance ?? distanceMeters(from.point, to.point);
  };
  const score = (label: Label) => label.walk + label.busDistance * busWeight;
  const keep = (labels: Map<string, Label>, stop: Stop, label: Label) => {
    const previous = labels.get(stop.key);
    if (label.walk <= walkingLimit && (!previous || score(label) < score(previous))) labels.set(stop.key, label);
  };

  let boardable = new Map<string, Label>();
  for (const stop of platforms.values()) keep(boardable, stop, { walk: walkCost(start, stop), busDistance: 0, rides: [] });
  const bestBoarding = new Map([...boardable].map(([key, label]) => [key, score(label)]));
  const candidates: Candidate[] = [];
  for (let leg = 0; leg < maxLegs && boardable.size; leg++) {
    const arrivals = new Map<string, Label>();
    const activeRoutes = new Set<number>();
    for (const platform of boardable.keys()) {
      for (const route of routesByPlatform.get(platform) ?? []) activeRoutes.add(route);
    }
    for (const route of activeRoutes) {
      const { line, stops, distances } = routes[route];
      let boarding: { index: number; label: Label } | undefined;
      let boardingScore = Infinity;
      for (let index = 0; index < stops.length; index++) {
        const stop = stops[index];
        if (boarding) keep(arrivals, stop, {
          walk: boarding.label.walk,
          busDistance: boarding.label.busDistance + distances[index] - distances[boarding.index],
          rides: [...boarding.label.rides, { route, line, stops, from: boarding.index, to: index }],
        });
        const here = boardable.get(stop.key);
        if (here) {
          const nextScore = score(here) - distances[index] * busWeight;
          if (nextScore < boardingScore - 1e-6) {
            boarding = { index, label: here };
            boardingScore = nextScore;
          }
        }
      }
    }
    let best: Label | undefined;
    boardable = new Map();
    for (const [key, label] of arrivals) {
      const stop = platforms.get(key)!;
      const finish = label.walk + walkCost(stop, end);
      if (finish <= walkingLimit && (!best || finish + label.busDistance * busWeight < score(best))) best = { ...label, walk: finish };
      if (leg + 1 === maxLegs) continue;
      for (const { stop: next, distance } of transfersFrom(stop)) {
        const walk = label.walk + walkCost(stop, next, distance);
        if (walk + label.busDistance * busWeight < (bestBoarding.get(next.key) ?? Infinity) - 1e-6) {
          keep(boardable, next, { ...label, walk });
        }
      }
    }
    if (best) {
      const walks: Walk[] = [];
      let from = start;
      for (const ride of best.rides) {
        walks.push({ from, to: ride.stops[ride.from] });
        from = ride.stops[ride.to];
      }
      walks.push({ from, to: end });
      candidates.push({ ...best, walks });
    }
    for (const [key, label] of boardable) bestBoarding.set(key, score(label));
  }
  return candidates;
}

function rideStep({ line, stops, from, to }: Ride): PlannerStep {
  // Match every platform in order so the displayed portion also respects
  // the direction on loop routes and overlapping sections of the geometry.
  let nearest = 0, first = 0;
  for (let index = 0; index <= to; index++) {
    let best = Infinity;
    for (let vertex = nearest; vertex < line.path.length; vertex++) {
      const distance = distanceMeters(stops[index].point, line.path[vertex]);
      if (distance < best) { best = distance; nearest = vertex; }
      if (best < 1) break;
    }
    if (index === from) first = nearest;
  }
  const path = nearest > first ? line.path.slice(first, nearest + 1) : stops.slice(from, to + 1).map(stop => stop.point);
  const distance = path.reduce((sum, point, index) => index ? sum + distanceMeters(path[index - 1], point) : sum, 0);
  return { mode: 'BUS', instruction: `${line.name}：${stops[from].name} → ${stops[to].name}`, distance, time: 0, path };
}

export async function planSavedBus(
  lines: readonly BusLine[], origin: PlannerPoint, destination: PlannerPoint, walkingLimit: number,
  verify: (from: PlannerPoint['location'], to: PlannerPoint['location']) => Promise<PlannerStep | null>,
  cancelled: () => boolean,
): Promise<BusPlan[]> {
  const verified: WalkResults = new Map();
  const plans: BusPlan[] = [];
  const accepted = new Set<string>();
  const network = indexSavedNetwork(lines);
  let checks = 0;
  // Straight-line distances only rank candidates. Every displayed walking leg
  // must be verified against the road network. Re-solve with measured weights.
  for (let pass = 0; pass < 4 && !cancelled(); pass++) {
    const candidates = [BUS_DISTANCE_WEIGHT, 0].flatMap(weight =>
      findCandidates(network, origin, destination, walkingLimit, verified, MAX_SAVED_BUS_LEGS, weight));
    const score = (candidate: Candidate) => candidate.walk + candidate.busDistance * BUS_DISTANCE_WEIGHT + (candidate.rides.length - 1) * TRANSFER_COST;
    candidates.sort((a, b) => score(a) - score(b));
    const before = checks;
    for (const candidate of candidates) {
      const key = candidate.rides.map(ride => `${ride.route}:${ride.from}>${ride.to}`).join('|');
      if (accepted.has(key)) continue;
      const steps: PlannerStep[] = [];
      let complete = true;
      for (let index = 0; index < candidate.walks.length; index++) {
        if (cancelled()) return [];
        const walk = candidate.walks[index];
        if (walk.from.key !== walk.to.key) {
          const key = walkKey(walk);
          if (!verified.has(key) && checks < 24) {
            checks++;
            verified.set(key, await verify(walk.from.point, walk.to.point));
          }
          const result = verified.get(key);
          if (!result) { complete = false; break; }
          steps.push({ ...result, instruction: `步行至${walk.to.name}` });
        }
        if (candidate.rides[index]) steps.push(rideStep(candidate.rides[index]));
      }
      const walking = steps.reduce((sum, step) => sum + (step.mode === 'WALK' ? step.distance : 0), 0);
      if (complete && walking <= walkingLimit) {
        accepted.add(key);
        plans.push({
          steps, walking, buses: candidate.rides.length,
          distance: steps.reduce((sum, step) => sum + step.distance, 0),
          time: 0,
        });
      }
    }
    if (checks === before || checks >= 24) break;
  }
  return paretoBusPlans(plans);
}
