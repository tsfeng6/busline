import type { BusLine } from '../types';
import type { CityDataset } from './cityDataset';
import { CITY_FILE_BYTES, isCityParts, resolveCityParts } from './cityStorage';
import { decodeRoute, indexCityGeometry, parseBvpkHeader } from './bvpGeometryDecoder';

export const CITY_BVPK_FORMAT = 'city-bvpk1';
export const CITY_BVPK_BLOCK_LIMIT = CITY_FILE_BYTES + 1024 * 1024;
export type CityPart = Pick<CityDataset, 'lines' | 'stops'>;
type LineMetadata = Omit<BusLine, 'path'> & { path?: BusLine['path'] };
export type BrotliDecode = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;
export interface CityBvpkPart {
  sha256: string;
  bytes: number;
  lineCount: number;
  stopCount: number;
}
export interface CityBvpkManifest {
  storage: typeof CITY_BVPK_FORMAT;
  snapshotId: string;
  header: Omit<CityDataset, 'lines' | 'stops'>;
  parts: CityBvpkPart[];
}

export function cityBvpkPartPath(part: CityBvpkPart) {
  if (typeof part?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(part.sha256)) throw Error('BVPK1: 分片摘要无效。');
  return `bvpk/${part.sha256}.bvpk`;
}

export function cityBvpkManifest(value: any): CityBvpkManifest | null {
  if (value?.storage !== CITY_BVPK_FORMAT) return null;
  if (typeof value.snapshotId !== 'string' || !/^[\dTZ-]+-[a-f0-9]{12}$/.test(value.snapshotId) || value.header?.schemaVersion !== 1
    || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > 256) throw Error('BVPK1: 清单无效。');
  for (const part of value.parts) {
    cityBvpkPartPath(part);
    if (!Number.isInteger(part.bytes) || part.bytes < 15 || part.bytes > CITY_BVPK_BLOCK_LIMIT
      || !Number.isInteger(part.lineCount) || part.lineCount < 0 || part.lineCount > 10000
      || !Number.isInteger(part.stopCount) || part.stopCount < 0 || part.stopCount > 100000) throw Error('BVPK1: 分片清单无效。');
  }
  return value;
}

/** Index routes without decoding their paths. Also accepts the Beijing/Jinzhou experimental metadata. */
export async function openBvpk(bytes: Uint8Array, decompress: BrotliDecode) {
  const header = parseBvpkHeader(bytes);
  if (!header.valid || !header.metaLength || !header.geomLength) throw Error('BVPK1: 文件头或长度无效。');
  const geometryOffset = 13 + header.metaLength;
  const metaBytes = await decompress(bytes.subarray(13, geometryOffset));
  const metadata: Omit<CityPart, 'lines'> & { lines: LineMetadata[] } = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metaBytes));
  const geometry = indexCityGeometry(await decompress(bytes.subarray(geometryOffset)));
  if (!Array.isArray(metadata?.lines) || !Array.isArray(metadata.stops) || metadata.lines.length !== geometry.spans.length) {
    throw Error('BVPK1: 线路元数据和轨迹索引不匹配。');
  }
  return {
    metadata,
    route(index: number): BusLine {
      const path = decodeRoute(geometry, index);
      const line = metadata.lines[index];
      if (!line || typeof line !== 'object' || Array.isArray(line)) throw Error('BVPK1: 线路元数据无效。');
      if (line.path !== undefined) {
        // An empty frame reserves the line's position when its exact coordinates exceed BVP1 precision.
        if (path.length || !Array.isArray(line.path) || !line.path.length) throw Error('BVPK1: 精确轨迹无效。');
        return { ...line, path: line.path };
      }
      return { ...line, path };
    },
  };
}

export async function readCityBvpkPart(
  part: CityBvpkPart,
  read: (path: string) => Promise<Uint8Array>,
  decompress: BrotliDecode,
  digest: (bytes: Uint8Array) => string | Promise<string>,
): Promise<CityPart> {
  const bytes = await read(cityBvpkPartPath(part));
  if (bytes.byteLength !== part.bytes || await digest(bytes) !== part.sha256) throw Error('BVPK1: 分片校验失败。');
  const pack = await openBvpk(bytes, decompress);
  if (pack.metadata.lines.length !== part.lineCount || pack.metadata.stops.length !== part.stopCount) {
    throw Error('BVPK1: 分片记录数量不匹配。');
  }
  return { lines: pack.metadata.lines.map((_, index) => pack.route(index)), stops: pack.metadata.stops };
}

export async function resolveCityStorage(
  value: any,
  readJSON: (path: string) => Promise<any>,
  readBvpk: (part: CityBvpkPart) => Promise<CityPart>,
) {
  const manifest = cityBvpkManifest(value);
  if (!manifest) {
    if (value?.storage !== undefined && !isCityParts(value)) throw Error('不支持的城市数据格式。');
    return resolveCityParts(value, readJSON);
  }
  const data: CityDataset = { ...manifest.header, lines: [], stops: [] };
  for (const descriptor of manifest.parts) {
    const part = await readBvpk(descriptor);
    for (const line of part.lines) data.lines.push(line);
    for (const stop of part.stops) data.stops.push(stop);
  }
  return data;
}
