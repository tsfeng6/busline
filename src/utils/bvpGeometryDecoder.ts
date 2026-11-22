/**
 * Busline BVP1 geometry decoder（复制自实验包 `busline_geometry_decoder.ts`，逻辑未改），
 * 供浏览器/TS 真实解码 `.bvp` 未压缩几何。另附 BVPK1 13 字节容器头解析。
 *
 * 不要直接把 Brotli 压缩字节传入本解析器；BVP1 需要未压缩几何字节。
 */

export type GeoPath = Array<[number, number]>;
type Cursor = { p: number };

function readUnsignedVarint(buf: Uint8Array, c: Cursor, end: number): number {
  let n = 0;
  for (let i = 0; i < 10; i++) {
    if (c.p >= end) throw new Error('BVP1: truncated varint');
    const b = buf[c.p++];
    n += (b & 0x7f) * 2 ** (7 * i);
    if (!Number.isSafeInteger(n)) throw new Error('BVP1: varint exceeds JS safe integer');
    if ((b & 0x80) === 0) return n;
  }
  throw new Error('BVP1: varint too long');
}

function unzig(n: number): number {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

export interface RouteSpan { offset: number; length: number }
export interface CityGeometryIndex { data: Uint8Array; spans: RouteSpan[] }

export function indexCityGeometry(data: Uint8Array): CityGeometryIndex {
  if (data.length < 5 || String.fromCharCode(...data.subarray(0, 4)) !== 'BVP1') {
    throw new Error('BVP1: invalid magic');
  }
  const c: Cursor = { p: 4 };
  const count = readUnsignedVarint(data, c, data.length);
  if (count > 1_000_000) throw new Error('BVP1: invalid line count');
  const lengths: number[] = [];
  for (let i = 0; i < count; i++) lengths.push(readUnsignedVarint(data, c, data.length));
  const spans: RouteSpan[] = [];
  for (const length of lengths) {
    if (c.p + length > data.length) throw new Error('BVP1: incomplete route frame');
    spans.push({ offset: c.p, length });
    c.p += length;
  }
  if (c.p !== data.length) throw new Error('BVP1: unexpected trailing bytes');
  return { data, spans };
}

export function decodeRoute(index: CityGeometryIndex, routeIndex: number): GeoPath {
  const span = index.spans[routeIndex];
  if (!span) throw new RangeError(`BVP1: unknown route index ${routeIndex}`);
  const { data } = index;
  const end = span.offset + span.length;
  const c: Cursor = { p: span.offset };
  const mode = data[c.p++];
  if (mode !== 0 && mode !== 1) throw new Error(`BVP1: unknown codec ${mode}`);
  const count = readUnsignedVarint(data, c, end);
  if (count > 5_000_000) throw new Error('BVP1: unreasonable point count');
  const points: GeoPath = [];
  if (count > 0) {
    let x = unzig(readUnsignedVarint(data, c, end));
    let y = unzig(readUnsignedVarint(data, c, end));
    points.push([x / 1e6, y / 1e6]);
    let lastDx = 0, lastDy = 0;
    while (points.length < count) {
      let dx: number, dy: number;
      if (mode === 0) {
        dx = unzig(readUnsignedVarint(data, c, end));
        dy = unzig(readUnsignedVarint(data, c, end));
        x += dx; y += dy;
        points.push([x / 1e6, y / 1e6]);
      } else {
        const tag = readUnsignedVarint(data, c, end);
        if (tag === 0) {
          const reps = readUnsignedVarint(data, c, end);
          if (reps < 1 || points.length + reps > count) throw new Error('BVP1: invalid vector run');
          for (let j = 0; j < reps; j++) {
            x += lastDx; y += lastDy;
            points.push([x / 1e6, y / 1e6]);
          }
        } else {
          dx = unzig(tag - 1);
          dy = unzig(readUnsignedVarint(data, c, end));
          x += dx; y += dy;
          points.push([x / 1e6, y / 1e6]);
          lastDx = dx; lastDy = dy;
        }
      }
    }
  }
  if (c.p !== end) throw new Error('BVP1: route frame trailing bytes');
  return points;
}

/**
 * BVPK1 容器头（13 字节）：`BVPK1`(5) + uint32LE metaLen(4) + uint32LE geomLen(4)，
 * 其后为 meta 的 Brotli 块与 geometry 的 Brotli 块。仅解析头部与长度一致性，不解 Brotli。
 */
export interface BvpkHeader { magic: string; metaLength: number; geomLength: number; totalLength: number; valid: boolean; }
export function parseBvpkHeader(data: Uint8Array): BvpkHeader {
  const magic = data.length >= 5 ? String.fromCharCode(...data.subarray(0, 5)) : '';
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const metaLength = data.length >= 13 ? view.getUint32(5, true) : 0;
  const geomLength = data.length >= 13 ? view.getUint32(9, true) : 0;
  const valid = magic === 'BVPK1' && data.length >= 13 && 13 + metaLength + geomLength === data.length;
  return { magic, metaLength, geomLength, totalLength: data.length, valid };
}
