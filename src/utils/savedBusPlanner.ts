import type { BusLine } from '../types';
import type { BusPlan, PlannerPoint, PlannerStep } from './busPlanner';
import { isLocalBusLine } from './busPlanner';
import { distanceMeters, type Point } from './localTransit';

export const MAX_TRANSFER_RADIUS = 800;
export type BusPlanPriority = '推荐' | '少换乘' | '少步行';

export const LONG_WALK_WARNING = '自由通行距离较长';
// AMap Walking verifies individual legs up to 100 km.
const MAX_WALKING_REQUEST = 100_000;
const gridSize = .01;
const BUS_DISTANCE_WEIGHT = .22;
const TRANSFER_COST = 450;
const SHORT_TRANSFER_RIDE = 800;

type Stop = { name: string; point: Point; key: string };
type Ride = { route: number; line: BusLine; stops: Stop[]; from: number; to: number };
type RideChain = { ride: Ride; previous?: RideChain };
type Label = { walk: number; busDistance: number; chain?: RideChain };
type Walk = { from: Stop; to: Stop };
type Candidate = { walk: number; busDistance: number; rides: Ride[]; walks: Walk[] };
type WalkResults = Map<string, PlannerStep | null>;
type TransferLink = { stop: Stop; distance: number };

function stopAt(name: string, point: Point): Stop {
  return { name, point, key: point.map(value => value.toFixed(6)).join(',') };
}

function walkKey({ from, to }: Walk) { return from.key + '>' + to.key; }

function gridKey(x: number, y: number) { return x + ':' + y; }

// If an itinerary leaves a directed service only to board it farther along
// the same run, the rider can remain on board through the intermediate stops.
function continuousRides(rides: readonly Ride[]): Ride[] {
  const result: Ride[] = [];
  for (const ride of rides) {
    let previous = result.length - 1;
    while (previous >= 0 && (result[previous].route !== ride.route || result[previous].to > ride.from)) previous--;
    if (previous < 0) result.push(ride);
    else result.splice(previous, result.length - previous, { ...result[previous], to: ride.to });
  }
  return result;
}

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

export async function replaceShortTransferRides(
  plan: BusPlan, walkingLimit: number,
  verify: (from: Point, to: Point) => Promise<PlannerStep | null>, cancelled: () => boolean,
  services?: ReadonlyMap<string, readonly BusLine[]>,
): Promise<BusPlan> {
  const steps = [...plan.steps];
  let { walking, distance, time, buses } = plan;
  for (let index = 1; index < steps.length - 1 && !cancelled(); index++) {
    const ride = steps[index];
    if (ride.mode !== 'BUS' || ride.distance > SHORT_TRANSFER_RIDE) continue;
    let before = index - 1, after = index + 1;
    while (before >= 0 && steps[before].mode === 'WALK') before--;
    while (after < steps.length && steps[after].mode === 'WALK') after++;
    if (before < 0 || after >= steps.length) continue;
    // Try to bypass a sequence of short rides at once. If the walk is too
    // long or unverified, still try removing just the first short ride.
    let following = after;
    while (following < steps.length && (steps[following].mode === 'WALK' || steps[following].distance <= SHORT_TRANSFER_RIDE)) following++;
    for (const target of following > after && following < steps.length ? [following, after] : [after]) {
      const prior = steps[before], next = steps[target];
      const from = prior.to ?? prior.path.at(-1), to = next.from ?? next.path[0];
      if (!from || !to) continue;
      const removed = steps.slice(before + 1, target);
      const removedBuses = removed.filter(step => step.mode === 'BUS').length;
      const oldWalking = removed.reduce((sum, step) => sum + (step.mode === 'WALK' ? step.distance : 0), 0);
      const removedDistance = removed.reduce((sum, step) => sum + step.distance, 0);
      const allowance = Math.min(oldWalking + SHORT_TRANSFER_RIDE * removedBuses, walkingLimit - walking + oldWalking);
      const options = [{ ride: prior, alight: from, score: distanceMeters(from, to) }];
      const serviceName = prior.instruction.split('：', 1)[0];
      const board = prior.from ?? prior.path[0];
      if (board && services) for (const line of services.get(serviceName) ?? []) {
        const stops = (line.via_stops ?? []).map(stop => stopAt(stop.name,
          Array.isArray(stop.location) ? stop.location as Point : [stop.location?.lng, stop.location?.lat]));
        if (stops.some(stop => !stop.point.every(Number.isFinite))) continue;
        const fromIndex = stops.findIndex(stop => distanceMeters(stop.point, board) < 1);
        const toIndex = stops.findIndex((stop, i) => i > fromIndex && distanceMeters(stop.point, from) < 1);
        if (fromIndex < 0 || toIndex < 0) continue;
        for (let i = toIndex + 1; i < stops.length; i++) {
          const alight = stops[i].point;
          const walk = distanceMeters(alight, to);
          if (walk > allowance || walk >= options[0].score) continue;
          const ride = rideStep({ route: 0, line, stops, from: fromIndex, to: i });
          const extraRide = Math.max(0, ride.distance - prior.distance);
          // Trading short shuttles for a long excursion on the prior bus
          // would defeat the shortcut even if the walk became shorter.
          if (extraRide > removedDistance + SHORT_TRANSFER_RIDE * removedBuses) continue;
          options.push({ ride, alight, score: walk + extraRide * BUS_DISTANCE_WEIGHT });
        }
      }
      options.sort((a, b) => a.score - b.score);
      let simplified = false;
      for (const option of options) {
        if (distanceMeters(option.alight, to) > allowance) continue;
        const sameStop = option.alight[0] === to[0] && option.alight[1] === to[1];
        const link = sameStop ? null : await verify(option.alight, to);
        if (cancelled()) return plan;
        if (!sameStop && (!link || link.distance > allowance)) continue;
        const name = next.instruction.split('：')[1]?.split(' → ')[0];
        const replacement = link ? [{ ...link, instruction: name ? `步行至${name}换乘` : '步行换乘', from: option.alight, to }] : [];
        steps.splice(before, removed.length + 1, option.ride, ...replacement);
        walking += (link?.distance ?? 0) - oldWalking;
        distance += option.ride.distance - prior.distance + (link?.distance ?? 0) - removedDistance;
        if (plan.time > 0) time = Math.max(0, time + option.ride.time - prior.time + (link?.time ?? 0) - removed.reduce((sum, step) => sum + step.time, 0));
        buses -= removedBuses;
        index = before;
        simplified = true;
        break;
      }
      if (simplified) break;
    }
  }
  return buses === plan.buses ? plan : { steps, walking, distance, time, buses };
}

export function combineBusPlans(before: BusPlan[], after: BusPlan[], walkingLimit: number): BusPlan[] {
  return paretoBusPlans(before.flatMap(a => after.map(b => ({
    steps: [...a.steps, ...b.steps], time: a.time + b.time, distance: a.distance + b.distance,
    walking: a.walking + b.walking, buses: a.buses + b.buses,
  }))).filter(plan => plan.walking <= walkingLimit));
}

export function hasLongWalking(plan: BusPlan, preferredWalking: number) {
  return plan.walking > preferredWalking || plan.steps.some(step => step.mode === 'WALK' && step.distance > 3000);
}

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

type SearchLabel = { stop: Stop; walking: number; score: number; ride?: Ride; previous?: SearchLabel };
type WalkingCell = { stops: Stop[]; remaining: number; unknown: number; highestScore: number };

// Walking-only labels may board a bus. Arrival labels can also walk to
// another platform. This keeps walking transfers from chaining invisibly.
async function findLongConnectionCandidate(
  { platforms, routes }: ReturnType<typeof indexSavedNetwork>,
  start: Stop, end: Stop, range: number, upperBound: number, walkingLimit: number, busWeight: number,
  verified: WalkResults, reverse: boolean, cancelled: () => boolean, boardingPenalty: number, keepWalkingTradeoffs: boolean,
): Promise<SearchLabel | undefined> {
  const departures = new Map<string, { ride: Ride; distance: number }[]>();
  const cells = new Map<string, WalkingCell>();
  const cellSize = .05;
  const cellFor = (point: Point) => gridKey(Math.floor(point[0] / cellSize), Math.floor(point[1] / cellSize));
  for (const [route, { line, stops, distances }] of routes.entries()) {
    for (let i = 1; i < stops.length; i++) {
      const key = stops[reverse ? i : i - 1].key;
      const rides = departures.get(key) ?? [];
      rides.push({ ride: { route, line, stops, from: i - 1, to: i }, distance: distances[i] - distances[i - 1] });
      departures.set(key, rides);
    }
  }
  const bestBoarding = new Map<string, SearchLabel>();
  const bestArrival = new Map<string, SearchLabel>();
  const bestOnboard = new Map<string, SearchLabel>();
  const boarded = new Set<string>();
  const tradeoffs = new Map<string, SearchLabel[]>();
  const keep = (key: string, label: SearchLabel) => {
    const previous = tradeoffs.get(key) ?? [];
    if (previous.some(other => other.score <= label.score && other.walking <= label.walking)) return false;
    tradeoffs.set(key, [...previous.filter(other => other.score < label.score || other.walking < label.walking), label]);
    return true;
  };
  const boardingState = (label: SearchLabel) => (label.ride ? 'arrive:' : 'board:') + label.stop.key;
  const onboardState = (ride: Ride) => 'on:' + onboardKey(ride);
  const queue: SearchLabel[] = [];
  let best: SearchLabel | undefined;
  const checkedByStop = new Map<string, WalkResults>();
  for (const [key, result] of verified) {
    const endpoints = key.split('>');
    const [from, to] = reverse ? endpoints.reverse() : endpoints;
    const checked = checkedByStop.get(from) ?? new Map();
    checked.set(to, result);
    checkedByStop.set(from, checked);
  }
  const walkingCost = (from: Stop, to: Stop, direct: number) => {
    if (from.key === to.key) return 0;
    if (direct > range) return Infinity;
    const result = checkedByStop.get(from.key)?.get(to.key);
    return result === null || (result && result.distance > MAX_WALKING_REQUEST) ? Infinity : result?.distance ?? direct;
  };
  const estimate = (from: Stop, to: Stop) => reverse ? distanceMeters(to.point, from.point) : distanceMeters(from.point, to.point);
  const onboardKey = (ride: Ride) => `${ride.route}:${reverse ? ride.from : ride.to}`;
  const continues = (ride: Ride, next: Ride) =>
    ride.route === next.route && (reverse ? ride.from === next.to : ride.to === next.from);
  const enqueue = (label: SearchLabel) => {
    if (label.walking > walkingLimit || label.score > upperBound) return;
    const labels = label.ride ? bestArrival : bestBoarding;
    const key = label.stop.key;
    const improvesStop = label.score < (labels.get(key)?.score ?? Infinity);
    if (keepWalkingTradeoffs) {
      const improvesArrival = keep(boardingState(label), label);
      const improvesRide = label.ride && keep(onboardState(label.ride), label);
      if (!improvesArrival && !improvesRide) return;
    } else if (boardingPenalty && label.ride) {
      const onboard = onboardKey(label.ride);
      if (label.score >= (bestOnboard.get(onboard)?.score ?? Infinity)) return;
      bestOnboard.set(onboard, label);
    } else if (!improvesStop) return;
    if (!bestBoarding.has(key) && !bestArrival.has(key)) cells.get(cellFor(label.stop.point))!.unknown--;
    if (improvesStop) labels.set(key, label);
    let index = queue.length;
    queue.push(label);
    while (index && queue[(index - 1) >> 1].score > label.score) {
      queue[index] = queue[(index - 1) >> 1];
      index = (index - 1) >> 1;
    }
    queue[index] = label;
  };
  const dequeue = () => {
    const first = queue[0], tail = queue.pop()!;
    if (!queue.length) return first;
    let index = 0;
    while (index * 2 + 1 < queue.length) {
      let child = index * 2 + 1;
      if (child + 1 < queue.length && queue[child + 1].score < queue[child].score) child++;
      if (queue[child].score >= tail.score) break;
      queue[index] = queue[child];
      index = child;
    }
    queue[index] = tail;
    return first;
  };

  for (const stop of platforms.values()) {
    const key = cellFor(stop.point);
    const cell = cells.get(key) ?? { stops: [], remaining: 0, unknown: 0, highestScore: Infinity };
    cell.stops.push(stop);
    cell.remaining++;
    cell.unknown++;
    cells.set(key, cell);
  }
  for (const stop of platforms.values()) {
    const walking = walkingCost(start, stop, estimate(start, stop));
    enqueue({ stop, walking, score: walking });
  }
  let nextYield = Date.now() + 32;
  while (queue.length && !cancelled()) {
    if (Date.now() >= nextYield) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (cancelled()) return;
      nextYield = Date.now() + 32;
    }
    const label = dequeue();
    const { stop, walking, score, ride } = label;
    if (score > upperBound || (best && score === upperBound)) break;
    const stopDepartures = departures.get(stop.key) ?? [];
    if (boardingPenalty && ride && (keepWalkingTradeoffs
      ? tradeoffs.get(onboardState(ride))?.includes(label)
      : bestOnboard.get(onboardKey(ride)) === label)) {
      // Reaching a stop on foot at lower cost does not replace an onboard
      // arrival. Staying on the same bus does not pay another boarding cost.
      const continuation = stopDepartures.find(next => continues(ride, next.ride));
      if (continuation) {
        const next = continuation.ride;
        enqueue({ stop: next.stops[reverse ? next.from : next.to], walking,
          score: score + continuation.distance * busWeight, ride: next, previous: label });
      }
    }
    if (keepWalkingTradeoffs) {
      if (!tradeoffs.get(boardingState(label))?.includes(label)) continue;
    } else if ((ride ? bestArrival : bestBoarding).get(stop.key) !== label) continue;
    if (keepWalkingTradeoffs || !boarded.has(stop.key)) {
      if (!keepWalkingTradeoffs) {
        boarded.add(stop.key);
        cells.get(cellFor(stop.point))!.remaining--;
      }
      for (const { ride: next, distance } of stopDepartures) {
        if (boardingPenalty && ride && continues(ride, next)) continue;
        const boardingCost = boardingPenalty;
        enqueue({ stop: next.stops[reverse ? next.from : next.to], walking, score: score + distance * busWeight + boardingCost, ride: next, previous: label });
      }
    }
    if (!ride) continue;
    const finalWalk = walkingCost(stop, end, estimate(stop, end));
    const finish = score + finalWalk;
    if (walking + finalWalk <= walkingLimit && (finish < upperBound || (!best && finish === upperBound && Number.isFinite(finish)))) {
      upperBound = finish;
      best = { stop: end, walking: walking + finalWalk, score: finish, previous: label };
    }
    const remaining = Math.min(range, upperBound - score, walkingLimit - walking);
    const latPad = remaining / 110000;
    const longitudeScale = 110000 * Math.max(.1, Math.cos((Math.abs(stop.point[1]) + latPad) * Math.PI / 180));
    const lngPad = remaining / longitudeScale;
    const checked = checkedByStop.get(stop.key);
    for (let x = Math.floor((stop.point[0] - lngPad) / cellSize); x <= Math.floor((stop.point[0] + lngPad) / cellSize); x++) {
      for (let y = Math.floor((stop.point[1] - latPad) / cellSize); y <= Math.floor((stop.point[1] + latPad) / cellSize); y++) {
        const cell = cells.get(gridKey(x, y));
        if (!cell?.remaining) continue;
        // A settled cell, or one already reachable more cheaply through a bus
        // or another transfer, does not need every pair of stops compared.
        if (!keepWalkingTradeoffs && !checked?.size) {
          const west = x * cellSize, south = y * cellSize;
          const lngGap = Math.max(0, west - stop.point[0], stop.point[0] - west - cellSize);
          const latGap = Math.max(0, south - stop.point[1], stop.point[1] - south - cellSize);
          const lower = Math.hypot(lngGap * longitudeScale, latGap * 110000);
          if (lower > remaining || score + lower >= cell.highestScore) continue;
        }
        let highestScore = 0;
        for (const next of cell.stops) {
          if (boarded.has(next.key)) continue;
          const previousScore = keepWalkingTradeoffs ? Infinity
            : Math.min(bestBoarding.get(next.key)?.score ?? Infinity, bestArrival.get(next.key)?.score ?? Infinity);
          if (previousScore <= score) { highestScore = Math.max(highestScore, previousScore); continue; }
          const direct = estimate(stop, next);
          const walk = direct <= remaining ? walkingCost(stop, next, direct) : Infinity;
          const cost = score + walk;
          if (cost < previousScore && cost <= upperBound && walking + walk <= walkingLimit) {
            enqueue({ stop: next, walking: walking + walk, score: cost, previous: label });
            highestScore = Math.max(highestScore, cost);
          } else highestScore = Math.max(highestScore, previousScore);
        }
        if (!cell.unknown) cell.highestScore = Math.min(cell.highestScore, highestScore);
      }
    }
  }
  return best;
}

export async function planLongWalkingBus(
  lines: readonly BusLine[], origin: PlannerPoint, destination: PlannerPoint,
  verify: (from: Point, to: Point) => Promise<PlannerStep | null>, cancelled: () => boolean,
  onCandidates?: () => void,
  initialPlan?: BusPlan,
  walkingLimit = Infinity,
  priority: BusPlanPriority = '推荐',
): Promise<BusPlan[]> {
  const start = stopAt(origin.name, origin.location), end = stopAt(destination.name, destination.location);
  const network = indexSavedNetwork(lines);
  const verified: WalkResults = new Map();
  let nearbyStart = 0, nearbyEnd = 0;
  for (const platform of network.platforms.values()) {
    if (distanceMeters(platform.point, start.point) <= 15000) nearbyStart++;
    if (distanceMeters(platform.point, end.point) <= 15000) nearbyEnd++;
  }
  const reverse = nearbyEnd < nearbyStart;
  const [searchStart, searchEnd] = reverse ? [end, start] : [start, end];
  const baseline = initialPlan && initialPlan.walking <= walkingLimit ? initialPlan : undefined;
  for (const step of baseline?.steps ?? []) {
    if (step.mode === 'WALK' && step.from && step.to) verified.set(walkKey({
      from: stopAt('', step.from), to: stopAt('', step.to),
    }), step);
  }
  let best = baseline;
  const alternatives = baseline ? [baseline] : [];
  let busWeight = priority === '推荐' ? BUS_DISTANCE_WEIGHT : 0;
  // A simple path can board at most once per platform, with one final walk.
  // The penalty makes one extra boarding cost more than every walk combined.
  const transferPenalty = (network.platforms.size + 2) * MAX_WALKING_REQUEST;
  const boardingPenalty = () => priority === '少换乘' ? transferPenalty : busWeight ? TRANSFER_COST : 0;
  const scorePlan = (plan: BusPlan) =>
    plan.walking + plan.buses * boardingPenalty() + (plan.distance - plan.walking) * busWeight;
  const searchRanges = priority === '少换乘' ? [MAX_WALKING_REQUEST] : [3_000, 15_000, 50_000, MAX_WALKING_REQUEST];
  const ranges = [...new Set(searchRanges.map(range => Math.min(range, walkingLimit)))];
  let stage = 0;
  let comparisons = 0;
  let compareUntil = best ? Date.now() + 4_000 : Infinity;
  search: while (!cancelled()) {
    const comparing = best !== undefined;
    const finishComparison = () => priority === '推荐' && comparing && Date.now() >= compareUntil;
    if (finishComparison()) break;
    if (best && ((priority === '少步行' && best.walking === 0)
      || (priority === '少换乘' && best.buses === 1 && !Number.isFinite(walkingLimit)))) break;
    // A walking leg cannot exceed the entire score of a better itinerary.
    // Also respect any hard limit while comparing verified alternatives.
    const range = best ? Math.min(MAX_WALKING_REQUEST, scorePlan(best), walkingLimit) : ranges[stage];
    if (range === undefined || (range === 0 && best?.walking === 0 && priority !== '少换乘')) {
      if (!best && busWeight && Number.isFinite(walkingLimit) && walkingLimit > 0) {
        busWeight = 0;
        stage = 0;
        continue;
      }
      break;
    }
    const path = await findLongConnectionCandidate(network, searchStart, searchEnd, range,
      best ? scorePlan(best) : Infinity, walkingLimit, busWeight, verified, reverse,
      () => cancelled() || finishComparison(), boardingPenalty(), priority === '少换乘' && Number.isFinite(walkingLimit));
    if (cancelled()) return [];
    if (!path) {
      if (comparing) break;
      stage++;
      continue;
    }
    if (best && priority !== '推荐' && path.score >= scorePlan(best)) break;
    onCandidates?.();
    const rides: Ride[] = [];
    for (let node: SearchLabel | undefined = path; node; node = node.previous) {
      if (node.ride) rides.push(node.ride);
    }
    if (!reverse) rides.reverse();
    const pieces: (Ride | Walk)[] = [];
    let from = start;
    for (const ride of continuousRides(rides)) {
      const to = ride.stops[ride.from];
      if (from.key !== to.key) pieces.push({ from, to });
      pieces.push(ride);
      from = ride.stops[ride.to];
    }
    if (from.key !== end.key) pieces.push({ from, to: end });
    const steps: PlannerStep[] = [];
    let walking = 0, buses = 0, complete = true;
    for (const piece of pieces) {
      if (cancelled()) return [];
      if (finishComparison()) break search;
      if ('route' in piece) { steps.push(rideStep(piece)); buses++; continue; }
      const key = walkKey(piece);
      if (!verified.has(key)) verified.set(key, await verify(piece.from.point, piece.to.point));
      const result = verified.get(key);
      if (!result || result.distance > MAX_WALKING_REQUEST) { complete = false; break; }
      walking += result.distance;
      steps.push({ ...result, instruction: `步行至${piece.to.name}`, from: piece.from.point, to: piece.to.point });
    }
    if (complete && walking <= walkingLimit) {
      const plan = { steps, walking, buses, distance: steps.reduce((sum, step) => sum + step.distance, 0), time: 0 };
      alternatives.push(plan);
      if (!best || scorePlan(plan) < scorePlan(best)) {
        if (!best) compareUntil = Date.now() + 4_000;
        best = plan;
      }
    }
    if (priority === '推荐' && comparing && ++comparisons >= 3) break;
  }
  return best && !cancelled() ? paretoBusPlans(alternatives) : [];
}

export function savedBusCandidates(
  lines: readonly BusLine[], origin: PlannerPoint, destination: PlannerPoint,
  walkingLimit: number, verified: WalkResults,
): Candidate[] {
  return [...findCandidates(indexSavedNetwork(lines), origin, destination, walkingLimit, verified)]
    .filter((candidate): candidate is Candidate => candidate !== undefined);
}

// Each round scans only lines with a reachable boarding platform.
function* findCandidates(
  { platforms, routes, routesByPlatform, transfersFrom }: ReturnType<typeof indexSavedNetwork>,
  origin: PlannerPoint, destination: PlannerPoint, walkingLimit: number, verified: WalkResults,
  busWeight = 0,
): Generator<Candidate | undefined> {
  const start = stopAt(origin.name, origin.location);
  const end = stopAt(destination.name, destination.location);
  const verifiedByStart = new Map<string, WalkResults>();
  for (const [key, result] of verified) {
    const [from, to] = key.split('>');
    const links = verifiedByStart.get(from) ?? new Map();
    links.set(to, result);
    verifiedByStart.set(from, links);
  }
  const walkCost = (from: Stop, to: Stop) => {
    if (from.key === to.key) return 0;
    const result = verifiedByStart.get(from.key)?.get(to.key);
    return result === null ? Infinity : result?.distance ?? distanceMeters(from.point, to.point);
  };
  const score = (label: Label) => label.walk + label.busDistance * busWeight;
  const keep = (labels: Map<string, Label>, stop: Stop, label: Label) => {
    const previous = labels.get(stop.key);
    if (label.walk <= walkingLimit && (!previous || score(label) < score(previous))) labels.set(stop.key, label);
  };

  let boardable = new Map<string, Label>();
  const finalWalks = new Map<string, number>();
  for (const stop of platforms.values()) {
    keep(boardable, stop, { walk: walkCost(start, stop), busDistance: 0 });
    const walk = walkCost(stop, end);
    if (walk <= walkingLimit) finalWalks.set(stop.key, walk);
  }
  const bestBoarding = new Map([...boardable].map(([key, label]) => [key, score(label)]));
  const transferWeight = busWeight ? TRANSFER_COST : 0;
  let bestFinish = Infinity;
  for (let leg = 0; boardable.size; leg++) {
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
          chain: { ride: { route, line, stops, from: boarding.index, to: index }, previous: boarding.label.chain },
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
      const finish = label.walk + (finalWalks.get(key) ?? Infinity);
      if (finish <= walkingLimit && (!best || finish + label.busDistance * busWeight < score(best))) best = { ...label, walk: finish };
      const verifiedLinks = verifiedByStart.get(key);
      for (const { stop: next, distance } of transfersFrom(stop)) {
        const result = verifiedLinks?.get(next.key);
        if (result === null) continue;
        const walk = label.walk + (result?.distance ?? distance);
        if (walk + label.busDistance * busWeight < (bestBoarding.get(next.key) ?? Infinity) - 1e-6) {
          keep(boardable, next, { ...label, walk });
        }
      }
    }
    let candidate: Candidate | undefined;
    if (best && score(best) + leg * transferWeight < bestFinish) {
      bestFinish = score(best) + leg * transferWeight;
      const reversedRides: Ride[] = [];
      for (let chain = best.chain; chain; chain = chain.previous) reversedRides.push(chain.ride);
      const rides = continuousRides(reversedRides.reverse());
      const walks: Walk[] = [];
      let from = start;
      for (const ride of rides) {
        walks.push({ from, to: ride.stops[ride.from] });
        from = ride.stops[ride.to];
      }
      walks.push({ from, to: end });
      candidate = {
        walk: walks.reduce((sum, walk) => sum + walkCost(walk.from, walk.to), 0),
        busDistance: rides.reduce((sum, ride) => sum + routes[ride.route].distances[ride.to] - routes[ride.route].distances[ride.from], 0),
        rides, walks,
      };
    }
    // A later round cannot improve on zero walking, or on a weighted result
    // once the additional transfers alone cost as much as that result.
    if ((leg + 1) * transferWeight >= bestFinish) {
      yield candidate;
      break;
    }
    for (const [key, label] of boardable) bestBoarding.set(key, score(label));
    yield candidate;
  }
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
  return { mode: 'BUS', instruction: `${line.name}：${stops[from].name} → ${stops[to].name}`, distance, time: 0, path, from: stops[from].point, to: stops[to].point };
}

export async function planSavedBus(
  lines: readonly BusLine[], origin: PlannerPoint, destination: PlannerPoint, walkingLimit: number,
  verify: (from: PlannerPoint['location'], to: PlannerPoint['location']) => Promise<PlannerStep | null>,
  cancelled: () => boolean,
  onCandidates?: () => void,
  priority: BusPlanPriority = '推荐',
): Promise<BusPlan[]> {
  const verified: WalkResults = new Map();
  const plans: BusPlan[] = [];
  const accepted = new Set<string>();
  const network = indexSavedNetwork(lines);
  let checks = 0;
  let alternativeChecksUntil = Infinity;
  // Straight-line distances only rank candidates. Every displayed walking leg
  // must be verified against the road network. Re-solve with measured weights.
  while (!cancelled()) {
    const candidates: Candidate[] = [];
    let lastYield = Date.now();
    for (const weight of priority === '推荐' ? [BUS_DISTANCE_WEIGHT, 0] : [0]) {
      for (const candidate of findCandidates(network, origin, destination, walkingLimit, verified, weight)) {
        if (candidate) candidates.push(candidate);
        if (Date.now() - lastYield >= 32) {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (cancelled()) return [];
          lastYield = Date.now();
        }
      }
    }
    if (!candidates.length) break;
    onCandidates?.();
    const score = (candidate: Candidate) => candidate.walk + candidate.busDistance * BUS_DISTANCE_WEIGHT + (candidate.rides.length - 1) * TRANSFER_COST;
    candidates.sort((a, b) => priority === '少步行' ? a.walk - b.walk
      : priority === '少换乘' ? a.rides.length - b.rides.length || a.walk - b.walk : score(a) - score(b));
    const before = checks;
    for (const candidate of candidates) {
      const key = candidate.rides.map(ride => `${ride.route}:${ride.from}>${ride.to}`).join('|');
      if (accepted.has(key)) continue;
      const walkingSteps = new Map<number, PlannerStep>();
      let complete = true;
      const pendingWalks = new Set(candidate.walks.filter(walk => walk.from.key !== walk.to.key)
        .map(walkKey).filter(key => !verified.has(key)));
      if (checks + pendingWalks.size > alternativeChecksUntil) continue;
      for (let index = 0; index < candidate.walks.length; index++) {
        if (cancelled()) return [];
        const walk = candidate.walks[index];
        if (walk.from.key !== walk.to.key) {
          const key = walkKey(walk);
          if (!verified.has(key)) {
            checks++;
            verified.set(key, await verify(walk.from.point, walk.to.point));
          }
          const result = verified.get(key);
          if (!result) { complete = false; break; }
          walkingSteps.set(index, { ...result, instruction: `步行至${walk.to.name}`, from: walk.from.point, to: walk.to.point });
        }
      }
      const walking = [...walkingSteps.values()].reduce((sum, step) => sum + step.distance, 0);
      if (complete && walking <= walkingLimit) {
        if (!plans.length) alternativeChecksUntil = checks + 24;
        accepted.add(key);
        const steps = candidate.walks.flatMap((_, index) => {
          const walk = walkingSteps.get(index);
          const ride = candidate.rides[index];
          return [...(walk ? [walk] : []), ...(ride ? [rideStep(ride)] : [])];
        });
        plans.push({
          steps, walking, buses: candidate.rides.length,
          distance: steps.reduce((sum, step) => sum + step.distance, 0),
          time: 0,
        });
      }
    }
    if (checks === before || checks >= alternativeChecksUntil) break;
  }
  return paretoBusPlans(plans);
}
