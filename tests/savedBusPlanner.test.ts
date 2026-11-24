import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusLine } from '../src/types';
import type { PlannerPoint, PlannerStep } from '../src/utils/busPlanner';
import { distanceMeters, type Point, type PublishedCity } from '../src/utils/localTransit';
import type { CityDataset } from '../src/utils/cityDataset';
import { plannerCorridorCities } from '../src/utils/plannerCityCoverage';
import { collectPlannerStations, matchPlannerStations } from '../src/utils/plannerStops';
import { planSavedBus, recommendedBusPlans, savedBusCandidates, transfers } from '../src/utils/savedBusPlanner';

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

test('a through bus crossing a province boundary does not count as a transfer', async () => {
  const direct = bus('跨省公交1路', 116, 116.4, 117);
  const plans = await planSavedBus([direct, direct], crossBorderOrigin, crossBorderDestination, 100, verify, () => false);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].buses, 1);
  assert.equal(plans[0].walking, 0);
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
