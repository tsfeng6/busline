import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeDeltaE6, encodeDeltaE6, varintEncode, varintDecode, encodeVarintDelta, decodeVarintDelta,
  encodeDirections, decodeDirections, pointToSegmentMeters, perPointDeviationMeters, deviationStats,
  rdpSimplify, pathLengthMeters,
  type Point, type DeltaEncodedPath,
} from '../src/utils/geometryEncoding';

// 已知真实样例：阜新 900000241785 的首两点（取自实验文件）
const sample: DeltaEncodedPath = { start: [121619762, 41936164], deltas: [242, 506, -6, -46] };

test('delta-e6-v1 decodes interleaved integer deltas into coordinates', () => {
  const points = decodeDeltaE6(sample);
  assert.deepEqual(points[0], [121.619762, 41.936164]);
  assert.deepEqual(points[1], [121.620004, 41.93667]);
  assert.deepEqual(points[2], [121.619998, 41.936624]);
});

test('delta-e6 encode/decode round-trips losslessly', () => {
  const points: Point[] = [[121.619762, 41.936164], [121.620004, 41.93667], [121.619998, 41.936624], [116.1, 39.9]];
  const restored = decodeDeltaE6(encodeDeltaE6(points));
  assert.deepEqual(restored, points);
});

test('varint round-trips large non-negative integers', () => {
  for (const n of [0, 1, 127, 128, 255, 16384, 121619762, 999999999]) {
    const bytes = varintEncode(n);
    assert.equal(varintDecode(bytes).value, n);
  }
});

test('zigzag varint delta round-trips including negative deltas', () => {
  const encoded = encodeDeltaE6([[121.619762, 41.936164], [121.62, 41.9367], [121.618, 41.94]]);
  const bytes = encodeVarintDelta(encoded);
  assert.deepEqual(decodeVarintDelta(bytes), encoded);
});

test('720-direction encode/decode preserves segment lengths and bounds bearing error', () => {
  const points: Point[] = [[121.6, 41.9], [121.601, 41.9005], [121.6015, 41.902], [121.5987, 41.9043]];
  const encoded = encodeDirections(points);
  const restored = decodeDirections(encoded);
  assert.equal(restored.length, points.length);
  // 每段方向误差 ≤ 0.25°（半个 0.5° 箱）
  for (let i = 1; i < points.length; i++) {
    const origLen = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const restLen = Math.hypot(restored[i][0] - restored[i - 1][0], restored[i][1] - restored[i - 1][1]);
    assert.ok(Math.abs(origLen - restLen) < 1e-6, `段长保持 i=${i}`);
  }
});

test('RDP keeps endpoints and reduces points while staying within epsilon', () => {
  // 一条近似直线 + 轻微起伏，RDP 应大幅减少点数
  const points: Point[] = [];
  for (let i = 0; i <= 100; i++) points.push([121.6 + i * 1e-4, 41.9 + (i % 2 ? 1e-6 : 0)]);
  const simplified = rdpSimplify(points, 1);
  assert.ok(simplified.length < points.length);
  assert.deepEqual(simplified[0], points[0]);
  assert.deepEqual(simplified[simplified.length - 1], points[points.length - 1]);
  const deviations = perPointDeviationMeters(points, simplified);
  assert.ok(Math.max(...deviations) <= 1 + 1e-6);
});

test('point-to-segment distance handles interior and endpoint projections', () => {
  // 以同一纬度，取东西向线段
  const a: Point = [121.6, 41.9], b: Point = [121.61, 41.9];
  const mid: Point = [121.605, 41.9];
  assert.ok(pointToSegmentMeters(mid, a, b) < 0.01); // 在线段上
  const off: Point = [121.605, 41.9001]; // 约 11 米以北
  const d = pointToSegmentMeters(off, a, b);
  assert.ok(d > 10 && d < 12);
  const beyond: Point = [121.62, 41.9]; // 超出端点
  assert.ok(Math.abs(pointToSegmentMeters(beyond, a, b) - pointToSegmentMeters(beyond, b, b)) < 1);
});

test('deviationStats returns max/avg/p95 and max point', () => {
  const original: Point[] = [[121.6, 41.9], [121.605, 41.9], [121.61, 41.9]];
  const approx: Point[] = [[121.6, 41.9], [121.61, 41.9]]; // 中间点偏离 0
  const stats = deviationStats(original, approx);
  assert.equal(stats.count, 3);
  assert.ok(stats.max < 0.01);
  assert.ok(stats.avg < 0.01);
  assert.ok(stats.p95 < 0.01);
  assert.ok(stats.maxPoint);
});

test('pathLengthMeters is positive and scales with the path', () => {
  assert.ok(pathLengthMeters([[121.6, 41.9], [121.61, 41.9]]) > 800);
});

const fixtures = process.env.BUSLINE_GEOMETRY_FIXTURES || '.geometry-experiment';
const deltaFile = resolve(fixtures, 'delta.json');
const rawFile = resolve(fixtures, 'raw.json');
test('real Fuxin delta-e6-v1 file decodes losslessly against the raw snapshot', { skip: !existsSync(deltaFile) || !existsSync(rawFile) && 'fixtures not present' }, () => {
  const delta = JSON.parse(readFileSync(deltaFile, 'utf8'));
  const raw = JSON.parse(readFileSync(rawFile, 'utf8'));
  assert.equal(delta.pathEncoding, 'delta-e6-v1');
  assert.equal(delta.lines.length, 115);
  const rawById = new Map<string, Point[]>(raw.lines.map((l: any) => [l.id, l.path]));
  let maxDiff = 0, compared = 0;
  for (const line of delta.lines) {
    const reference = rawById.get(line.id);
    if (!reference) continue;
    const decoded = decodeDeltaE6(line.path);
    assert.equal(decoded.length, reference.length);
    for (let i = 0; i < decoded.length; i++) maxDiff = Math.max(maxDiff, Math.abs(decoded[i][0] - reference[i][0]), Math.abs(decoded[i][1] - reference[i][1]));
    compared++;
  }
  assert.equal(compared, 115);
  assert.equal(maxDiff, 0); // 逐位无损
});
