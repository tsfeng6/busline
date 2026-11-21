import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundsIntersect, expandBounds, citiesInViewport, neighborsOf, cityBoundsOf,
  type BoundedCity, type Bounds,
} from '../src/utils/viewportCities';

const cities: BoundedCity[] = [
  { city: '北京', bounds: [115.7, 39.4, 117.4, 41.1] },
  { city: '廊坊', bounds: [116.1, 38.4, 117.2, 40.2] },
  { city: '天津', bounds: [116.7, 38.5, 118.1, 40.2] },
  { city: '石家庄', bounds: [113.5, 37.4, 115.0, 38.8] },
];

test('boundsIntersect detects overlap and rejects disjoint boxes', () => {
  assert.equal(boundsIntersect([0, 0, 10, 10], [5, 5, 15, 15]), true);
  assert.equal(boundsIntersect([0, 0, 10, 10], [10, 0, 20, 10]), false); // touching edge is not overlap
  assert.equal(boundsIntersect([0, 0, 10, 10], [20, 20, 30, 30]), false);
});

test('expandBounds pads each dimension by ratio', () => {
  assert.deepEqual(expandBounds([0, 0, 10, 20], 0.5), [-5, -10, 15, 30]);
  assert.deepEqual(expandBounds([0, 0, 10, 20], 0), [0, 0, 10, 20]);
});

test('citiesInViewport returns only intersecting cities', () => {
  const viewport: Bounds = [115.8, 40.5, 116.6, 40.9]; // 北京北部，不含廊坊/天津（它们 maxLat 40.2）
  const names = citiesInViewport(cities, viewport);
  assert.deepEqual(names, ['北京']);
});

test('citiesInViewport handles a viewport spanning multiple cities', () => {
  const viewport: Bounds = [113.0, 37.0, 119.0, 41.5];
  assert.deepEqual(citiesInViewport(cities, viewport).sort(), ['北京', '天津', '廊坊', '石家庄'].sort());
});

test('touching edges are not treated as overlap', () => {
  const viewport: Bounds = [115.0, 38.0, 118.5, 41.5];
  // 石家庄 maxLng 恰好等于 viewport minLng 115.0，仅接触不算相交
  assert.ok(!citiesInViewport(cities, viewport).includes('石家庄'));
});

test('neighborsOf finds bounds-adjacent cities within tolerance and excludes self', () => {
  const neighbors = neighborsOf('北京', cities, 0.05).sort();
  assert.ok(neighbors.includes('廊坊'));
  assert.ok(neighbors.includes('天津'));
  assert.ok(!neighbors.includes('北京'));
  // 石家庄 is far from 北京 even with tolerance
  assert.ok(!neighbors.includes('石家庄'));
});

test('neighborsOf returns empty for an unknown city', () => {
  assert.deepEqual(neighborsOf('不存在的城市', cities), []);
});

test('cityBoundsOf returns the bounds or null', () => {
  assert.deepEqual(cityBoundsOf(cities, '廊坊'), [116.1, 38.4, 117.2, 40.2]);
  assert.equal(cityBoundsOf(cities, '不存在'), null);
});
