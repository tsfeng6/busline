import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusLine } from '../src/types';
import type { PlannerPoint, PlannerStep } from '../src/utils/busPlanner';
import { plannerBusSequence, plannerPlanText, plannerTransferPoints } from '../src/utils/busPlanner';
import { distanceMeters, type Point, type PublishedCity } from '../src/utils/localTransit';
import type { CityDataset } from '../src/utils/cityDataset';
import { plannerCorridorCities, plannerCorridorWidths, prioritizePlannerCities } from '../src/utils/plannerCityCoverage';
import { collectPlannerStations, matchPlannerStations } from '../src/utils/plannerStops';
import { combineBusPlans, hasLongWalking, planLongWalkingBus, planSavedBus, recommendedBusPlans, savedBusCandidates, transfers } from '../src/utils/savedBusPlanner';

const point = (lng: number): Point => [lng, 40];
const place = (lng: number): PlannerPoint => ({ city: '北京市', name: String(lng), location: point(lng) });
function bus(name: string, ...coordinates: number[]): BusLine {
  return {
    id: name, name, stops: [], path: coordinates.map(point),
    via_stops: coordinates.map(lng => ({ name: String(lng), location: point(lng) })),
  };
}
const network = [
  bus('1路', 116.006, 116.034),
  bus('2路', 116, 116.020),
  bus('3路', 116.021, 116.040),
];
const verify = async (from: Point, to: Point): Promise<PlannerStep> => ({
  mode: 'WALK', distance: Math.ceil(distanceMeters(from, to) * 1.5), time: 60, path: [from, to], instruction: '',
});

test('keeps both the direct bus and the shorter verified walk with a transfer', async () => {
  const plans = await planSavedBus(network, place(116), place(116.040), 3000, verify, () => false);
  assert.deepEqual(plans.map(transfers), [0, 1]);
  assert.ok(plans[1].walking < plans[0].walking);
  assert.deepEqual(plans[1].steps.map(step => step.mode), ['BUS', 'WALK', 'BUS']);
  assert.equal(plans[1].walking, (await verify(point(116.020), point(116.021))).distance);
});

test('respects one-way bus direction and excludes subway routes', () => {
  const lines = [bus('1路', 116, 116.040), bus('地铁9号线', 116.040, 116)];
  assert.equal(savedBusCandidates(lines, place(116.040), place(116), 100, new Map()).length, 0);
});

test('does not draw a straight-line shortcut when a walking connection is unavailable', async () => {
  const plans = await planSavedBus(network, place(116), place(116.040), 3000,
    async (from, to) => from[0] === 116.020 && to[0] === 116.021 ? null : verify(from, to),
    () => false);
  assert.ok(plans.length);
  assert.ok(plans.every(plan => plan.steps.every(step => step.mode !== 'WALK'
    || step.path[0][0] !== 116.020 || step.path.at(-1)?.[0] !== 116.021)));
});

test('recommends a short ride with a verified walk over a zero-walk detour', async () => {
  const origin = place(116), destination = place(116.1);
  const lines = [
    bus('绕行1路', 116, 116.5, 116.1),
    bus('顺路2路', 116.002, 116.05, 116.1),
  ];
  const plans = await planSavedBus(lines, origin, destination, 500, verify, () => false);
  const [recommended, detour] = recommendedBusPlans(plans);
  assert.match(recommended.steps.find(step => step.mode === 'BUS')!.instruction, /^顺路2路/);
  assert.ok(recommended.walking > 0);
  assert.equal(detour, undefined);
});

const city = (name: string, province: string, bounds: PublishedCity['bounds']): PublishedCity => ({
  city: name, province, bounds, center: [bounds[0], bounds[1]], lineDirections: 1, capturedAt: '', countySeats: [],
});
const crossBorderOrigin = { ...place(116), city: '北京市' };
const crossBorderDestination = { ...place(117), city: '天津市' };
const catalog = [
  city('北京', '北京', [115.8, 39.8, 116.1, 40.2]),
  city('廊坊', '河北', [116.3, 39.9, 116.8, 40.1]),
  city('保定', '河北', [116.4, 39.3, 116.8, 39.6]),
  city('石家庄', '河北', [114.3, 38.0, 114.7, 38.4]),
];

test('includes a third city across provincial borders, expanding the corridor when needed', async () => {
  assert.deepEqual(plannerCorridorCities(catalog, crossBorderOrigin, crossBorderDestination, 30), ['北京市', '天津市', '廊坊']);
  assert.deepEqual(plannerCorridorCities(catalog, crossBorderOrigin, crossBorderDestination, 100), ['北京市', '天津市', '廊坊', '保定']);
  const datasets: Record<string, BusLine[]> = {
    北京市: [bus('通勤1路', 116, 116.4)],
    廊坊: [bus('城际2路', 116.4, 116.8)],
    天津市: [bus('3路', 116.8, 117)],
  };
  const lines = plannerCorridorCities(catalog, crossBorderOrigin, crossBorderDestination, 30).flatMap(name => datasets[name]);
  const plans = await planSavedBus(lines, crossBorderOrigin, crossBorderDestination, 100, verify, () => false);
  assert.equal(plans[0].walking, 0);
  assert.equal(transfers(plans[0]), 2);
});

test('prioritizes cities in boundary crossing order and keeps unreadable cities as fallbacks', async () => {
  const boxes: Record<string, Point[]> = {
    东侧市: [[116.6, 39.9], [116.9, 39.9], [116.9, 40.1], [116.6, 40.1]],
    西侧市: [[116.1, 39.9], [116.3, 39.9], [116.3, 40.1], [116.1, 40.1]],
    北侧市: [[116.1, 40.2], [116.5, 40.2], [116.5, 40.5], [116.1, 40.5]],
  };
  const AMap = { DistrictSearch: class {
    search(name: string, callback: (status: string, result?: unknown) => void) {
      if (boxes[name]) callback('complete', { districtList: [{ name, boundaries: [boxes[name]] }] });
      else callback('error');
    }
  } };
  const names = ['北京市', '天津市', '东侧市', '北侧市', '西侧市', '未读取市'];
  assert.deepEqual(await prioritizePlannerCities(AMap, names, crossBorderOrigin, crossBorderDestination, () => false),
    ['北京市', '西侧市', '东侧市', '天津市', '北侧市', '未读取市']);
});

test('the final cross-city corridor can include a city beyond the original search area', () => {
  const nearbyDetour = city('绕行市', '河北', [116.3, 41.2, 116.8, 41.4]);
  const widths = plannerCorridorWidths(crossBorderOrigin, crossBorderDestination);
  assert.ok(!plannerCorridorCities([nearbyDetour], crossBorderOrigin, crossBorderDestination, 100).includes(nearbyDetour.city));
  assert.ok(plannerCorridorCities([nearbyDetour], crossBorderOrigin, crossBorderDestination, widths.at(-1)!).includes(nearbyDetour.city));
});

test('marks both ends of a walking transfer and copies the complete selected trip', async () => {
  const origin = place(116), destination = place(116.04);
  const plans = await planSavedBus(network, origin, destination, 3000, verify, () => false);
  const trip = plans[1];
  assert.deepEqual(plannerTransferPoints(trip.steps), [point(116.020), point(116.021)]);
  assert.equal(plannerBusSequence(trip), '2路 → 3路');
  const text = plannerPlanText(trip, [origin, destination]);
  assert.match(text, /北京市 · 116 → 北京市 · 116.04/);
  assert.match(text, /换乘 1 次/);
  assert.match(text, /2\. 步行至/);
  assert.match(text, /3\. 3路/);
});

test('a through bus crossing a province boundary does not count as a transfer', async () => {
  const direct = bus('跨省公交1路', 116, 116.4, 117);
  const plans = await planSavedBus([direct, direct], crossBorderOrigin, crossBorderDestination, 100, verify, () => false);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].buses, 1);
  assert.equal(plans[0].walking, 0);
});

test('long trips can chain more than eight buses even inside one municipality', async () => {
  const longRoute = Array.from({ length: 12 }, (_, index) =>
    bus(`接驳${index + 1}路`, 113 + index * .25, 113 + (index + 1) * .25));
  const origin = place(113), destination = place(116);
  const plans = await planSavedBus(longRoute, origin, destination, 100, verify, () => false);
  assert.equal(plans[0].buses, 12);
  assert.equal(plans[0].walking, 0);
});

test('a Beijing-to-Guangzhou length chain verifies all transfers past the former limits', async () => {
  const origin: PlannerPoint = { city: '北京市', name: '起点', location: [116.4, 39.9] };
  const destination: PlannerPoint = { city: '广州市', name: '终点', location: [113.3, 23.1] };
  const count = 72;
  const stop = (index: number): Point => [
    origin.location[0] + (destination.location[0] - origin.location[0]) * index / count,
    origin.location[1] + (destination.location[1] - origin.location[1]) * index / count,
  ];
  const lines: BusLine[] = Array.from({ length: count }, (_, index) => {
    const name = `接驳${index + 1}路`;
    const start = stop(index);
    if (index) start[0] += .0005;
    const path = [start, stop(index + 1)];
    return { id: name, name, stops: [], path, via_stops: path.map((location, n) => ({ name: `${name}${n}`, location })) };
  });
  const widths = plannerCorridorWidths(origin, destination);
  assert.deepEqual(widths.slice(0, 2), [30, 100]);
  assert.ok(widths[2] > 200);
  let checks = 0;
  const plans = await planSavedBus(lines, origin, destination, 10_000,
    (from, to) => { checks++; return verify(from, to); }, () => false);
  assert.equal(plans[0].buses, count);
  assert.equal(checks, count - 1);
  assert.equal(plans[0].steps.filter(step => step.mode === 'WALK').length, count - 1);

  const disconnected = lines.filter((_, index) => index !== count / 2);
  assert.deepEqual(await planSavedBus(disconnected, origin, destination, 10_000, verify, () => false), []);
});

test('indicates reachable bus candidates without returning an unverified plan', async () => {
  let found = false;
  const plans = await planSavedBus([bus('1路', 116.001, 116.04)], place(116), place(116.04), 200,
    async () => null, () => false, () => { found = true; });
  assert.equal(found, true);
  assert.deepEqual(plans, []);
});

test('returns the shortest verified long connection after the preferred walking distance fails', async () => {
  const origin = place(116), destination = place(116.6);
  const lines = [
    bus('1路', 116, 116.10),
    bus('2路', 116.23, 116.6),
    bus('3路', 116.28, 116.6),
  ];
  assert.deepEqual(await planSavedBus(lines, origin, destination, 10000, verify, () => false), []);
  const plans = await planLongWalkingBus(lines, origin, destination, async (from, to) => {
    assert.ok(from[0] < to[0], 'walking verification stays in the requested direction');
    if (from[0] === 116.10 && to[0] === 116.23) return null;
    return verify(from, to);
  }, () => false);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].buses, 2);
  assert.equal(plannerBusSequence(plans[0]), '1路 → 3路');
  assert.equal(plans[0].walking, (await verify(point(116.10), point(116.28))).distance);
  assert.equal(hasLongWalking(plans[0], 10000), true);
});

test('an optional hard walking cap applies to the verified distance without rounding or clamping', async () => {
  const lines = [bus('1路', 116, 116.1), bus('2路', 116.28, 116.6)];
  const from = place(116), to = place(116.6);
  const walking = (await verify(point(116.1), point(116.28))).distance;
  const limited = (cap: number) => planLongWalkingBus(lines, from, to, verify, () => false, undefined, undefined, cap);
  assert.deepEqual(await limited(walking - .1), []);
  assert.equal((await limited(walking))[0].walking, walking);
  assert.equal((await limited(1_000_000))[0].walking, walking);
});

test('combines more than eight waypoint legs in order and applies the walking cap to the full trip', () => {
  const legs = Array.from({ length: 12 }, (_, index) => [{
    steps: [{ mode: 'BUS' as const, instruction: `第${index + 1}段`, path: [] as Point[], distance: 1000, time: 0 }],
    buses: 1, walking: 5000, distance: 6000, time: 0,
  }]);
  const empty = [{ steps: [], buses: 0, walking: 0, distance: 0, time: 0 }];
  const combine = (cap: number) => legs.reduce((before, after) => combineBusPlans(before, after, cap), empty);
  const [plan] = combine(Infinity);
  assert.deepEqual(plan.steps.map(step => step.instruction), legs.map(leg => leg[0].steps[0].instruction));
  assert.equal(combine(60_000)[0].walking, 60_000);
  assert.deepEqual(combine(59_999), []);
});

test('station suggestions are restricted to bus platforms and preserve separate same-name platforms', () => {
  const stations = collectPlannerStations({
    city: '北京市',
    lines: [
      { ...bus('公交1路', 116, 116.02), via_stops: [
        { name: '东门', location: point(116) }, { name: '东门南', location: point(116.02) },
      ] },
      { ...bus('公交2路', 116.001, 116.03), via_stops: [
        { name: '东门', location: point(116.001) }, { name: '城东门', location: point(116.03) },
      ] },
      bus('地铁9号线', 117, 117.1),
    ],
  } as CityDataset);
  assert.deepEqual(matchPlannerStations(stations, '东门公交站').map(station => station.name), ['东门', '东门', '东门南', '城东门']);
  assert.deepEqual(matchPlannerStations(stations, '东门', true).map(station => station.location), [point(116), point(116.001)]);
  assert.deepEqual(matchPlannerStations(stations, '117'), []);
});
