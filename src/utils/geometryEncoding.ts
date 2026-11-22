/**
 * 线路几何压缩对比工具的纯函数核心（开发期可视化实验用，不接入生产）。
 *
 * 已确认的真实编码（来自阜新实验文件，顶层 `pathEncoding: "delta-e6-v1"`）：
 *   line.path = { start: [round(lng*1e6), round(lat*1e6)], deltas: [dLng0,dLat0, dLng1,dLat1, ...] }
 *   相邻点差值以 1e-6 度为单位交错存放；累加还原，逐位无损（已对 115 条线路验证 max 偏差 0）。
 *
 * 其余三种为本工具基于同一几何定义的对照编码（原始文件未提供其格式，故在此自定义并标注）：
 *   - 720 方向：每段方向量化为 720 个方向之一（0.5°），保留段长；有损。
 *   - Varint+Brotli：把 delta 整数做 zigzag+varint 字节流再 brotli 压缩（压缩在 Node 侧完成）。
 *   - RDP：Ramer–Douglas–Peucker 简化（epsilon 以米计）。
 */

export type Point = [number, number]; // [lng, lat]，单位：度
export interface DeltaEncodedPath { start: [number, number]; deltas: number[]; }
export interface DirectionEncodedPath { start: Point; segments: { bin: number; lengthE6: number }[]; }

export const E6 = 1_000_000;
export const EARTH_M_PER_DEG_LAT = 110_540;
export const EARTH_M_PER_DEG_LNG_EQUATOR = 111_320;
export const DIRECTION_BINS = 720;

/** delta-e6-v1 解码：累加整数差值还原坐标。 */
export function decodeDeltaE6(encoded: DeltaEncodedPath): Point[] {
  if (!encoded || !Array.isArray(encoded.start) || encoded.start.length !== 2
    || !Number.isFinite(encoded.start[0]) || !Number.isFinite(encoded.start[1])) throw Error('无效 start');
  if (!Array.isArray(encoded.deltas) || encoded.deltas.length % 2 !== 0) throw Error('无效 deltas');
  let x = encoded.start[0], y = encoded.start[1];
  const points: Point[] = [[x / E6, y / E6]];
  for (let i = 0; i < encoded.deltas.length; i += 2) {
    x += encoded.deltas[i]; y += encoded.deltas[i + 1];
    points.push([x / E6, y / E6]);
  }
  return points;
}

/** delta-e6-v1 编码：坐标四舍五入到 1e-6 度后存首点与相邻差值。 */
export function encodeDeltaE6(points: Point[]): DeltaEncodedPath {
  if (!points || !points.length) throw Error('空线路');
  const sx = Math.round(points[0][0] * E6), sy = Math.round(points[0][1] * E6);
  const deltas: number[] = [];
  let px = sx, py = sy;
  for (let i = 1; i < points.length; i++) {
    const cx = Math.round(points[i][0] * E6), cy = Math.round(points[i][1] * E6);
    deltas.push(cx - px, cy - py); px = cx; py = cy;
  }
  return { start: [sx, sy], deltas };
}

const zigzag = (n: number): number => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

/** 无符号 varint（LEB128，按算术计算，支持到安全整数），返回字节数组。 */
export function varintEncode(value: number): number[] {
  if (!Number.isInteger(value) || value < 0) throw Error('varint 仅支持非负整数');
  const out: number[] = [];
  let v = value;
  do { const byte = v % 128; v = Math.floor(v / 128); out.push(v > 0 ? byte + 128 : byte); } while (v > 0);
  return out;
}

export function varintDecode(bytes: ArrayLike<number>, offset = 0): { value: number; next: number } {
  let value = 0, scale = 1, i = offset;
  for (;;) {
    const byte = bytes[i++];
    if (byte === undefined) throw Error('varint 截断');
    value += (byte % 128) * scale;
    if (byte < 128) return { value, next: i };
    scale *= 128;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(scale)) throw Error('varint 溢出');
  }
}

/** 把 delta-e6 的整数序列（start + deltas）编码为 zigzag-varint 字节流。 */
export function encodeVarintDelta(encoded: DeltaEncodedPath): Uint8Array {
  const ints = [encoded.start[0], encoded.start[1], ...encoded.deltas];
  const bytes: number[] = [];
  for (const n of ints) bytes.push(...varintEncode(zigzag(n)));
  return Uint8Array.from(bytes);
}

/** zigzag-varint 字节流还原为 delta-e6 编码。 */
export function decodeVarintDelta(bytes: ArrayLike<number>): DeltaEncodedPath {
  const values: number[] = [];
  let i = 0;
  while (i < bytes.length) { const r = varintDecode(bytes, i); values.push(unzigzag(r.value)); i = r.next; }
  if (values.length < 2 || (values.length - 2) % 2 !== 0) throw Error('varint delta 数量无效');
  return { start: [values[0], values[1]], deltas: values.slice(2) };
}

/** 720 方向编码：每段方向量化为 0.5° 箱，保留段长（米）。 */
export function encodeDirections(points: Point[], bins = DIRECTION_BINS): DirectionEncodedPath {
  if (!points || points.length < 1) throw Error('空线路');
  const segments: { bin: number; lengthE6: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dy);
    let bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (bearing < 0) bearing += 360;
    const bin = Math.round(bearing / (360 / bins)) % bins;
    segments.push({ bin, lengthE6: Math.round(len * E6) });
  }
  return { start: points[0], segments };
}

/** 720 方向解码：从起点按量化方向 + 段长逐段推进。 */
export function decodeDirections(encoded: DirectionEncodedPath, bins = DIRECTION_BINS): Point[] {
  const points: Point[] = [encoded.start];
  let x = encoded.start[0], y = encoded.start[1];
  for (const seg of encoded.segments) {
    const rad = ((seg.bin * 360) / bins) * (Math.PI / 180);
    x += Math.cos(rad) * (seg.lengthE6 / E6);
    y += Math.sin(rad) * (seg.lengthE6 / E6);
    points.push([x, y]);
  }
  return points;
}

function localMeters(p: Point, refLat: number, kx: number, ky: number, ox: number, oy: number): Point {
  return [(p[0] - ox) * kx, (p[1] - oy) * ky];
}

/** 点到线段的最短距离（米），使用以 refLat 为准的局部等距投影。 */
export function pointToSegmentMeters(p: Point, a: Point, b: Point, refLat = p[1]): number {
  const kx = EARTH_M_PER_DEG_LNG_EQUATOR * Math.cos((refLat * Math.PI) / 180), ky = EARTH_M_PER_DEG_LAT;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  let t = len2 ? -(ax * dx + ay * dy) / len2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** 原始点集到近似折线的逐点最近距离（米），用于点数不同的几何偏差衡量。 */
export function perPointDeviationMeters(original: Point[], approx: Point[]): number[] {
  if (!original.length) return [];
  const refLat = original.reduce((s, p) => s + p[1], 0) / original.length;
  const segments = approx.length >= 2 ? approx : [approx[0], approx[0]];
  return original.map((p) => {
    let best = Infinity;
    for (let i = 0; i < segments.length - 1; i++) {
      const d = pointToSegmentMeters(p, segments[i], segments[i + 1], refLat);
      if (d < best) best = d;
    }
    return best;
  });
}

export interface DeviationStats {
  max: number; avg: number; p95: number;
  maxIndex: number; maxPoint: Point | null; count: number;
}

/** 最大/平均/P95 偏差，并给出最大偏差所在原始点的坐标（供地图定位）。 */
export function deviationStats(original: Point[], approx: Point[]): DeviationStats {
  const distances = perPointDeviationMeters(original, approx);
  if (!distances.length) return { max: 0, avg: 0, p95: 0, maxIndex: -1, maxPoint: null, count: 0 };
  let max = 0, sum = 0, maxIndex = 0;
  distances.forEach((d, i) => { sum += d; if (d > max) { max = d; maxIndex = i; } });
  const sorted = [...distances].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.round(0.95 * (sorted.length - 1))));
  return { max, avg: sum / distances.length, p95: sorted[p95Index], maxIndex, maxPoint: original[maxIndex], count: distances.length };
}

/** RDP 简化：epsilon 以米计，保留首末点，按点到线段距离递归剔除。 */
export function rdpSimplify(points: Point[], epsilonMeters: number): Point[] {
  if (points.length <= 2) return points.slice();
  const refLat = points.reduce((s, p) => s + p[1], 0) / points.length;
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxD = -1, index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = pointToSegmentMeters(points[i], points[start], points[end], refLat);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (maxD > epsilonMeters && index > 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** 折线长度（米）。 */
export function pathLengthMeters(points: Point[]): number {
  const refLat = points.length ? points.reduce((s, p) => s + p[1], 0) / points.length : 0;
  const kx = EARTH_M_PER_DEG_LNG_EQUATOR * Math.cos((refLat * Math.PI) / 180), ky = EARTH_M_PER_DEG_LAT;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot((points[i][0] - points[i - 1][0]) * kx, (points[i][1] - points[i - 1][1]) * ky);
  return total;
}
