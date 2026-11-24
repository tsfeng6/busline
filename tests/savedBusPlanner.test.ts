import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusLine } from '../src/types';
import type { PlannerPoint, PlannerStep } from '../src/utils/busPlanner';
import { distanceMeters, type Point } from '../src/utils/localTransit';
import { planSavedBus, savedBusCandidates, transfers } from '../src/utils/savedBusPlanner';

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
