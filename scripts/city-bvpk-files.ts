import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import {
  CITY_BVPK_BLOCK_LIMIT, CITY_BVPK_FORMAT, cityBvpkPartPath, openBvpk, readCityBvpkPart,
  type CityBvpkManifest, type CityBvpkPart, type CityPart,
} from '../src/utils/cityBvpk';
import { parseBvpkHeader } from '../src/utils/bvpGeometryDecoder';
import { CITY_FILE_BYTES } from '../src/utils/cityStorage';
import type { CityDataset } from '../src/utils/cityDataset';

const scale = 1_000_000;
const zigzag = (value: number) => value < 0 ? -value * 2 - 1 : value * 2;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const decompress = (bytes: Uint8Array) => brotliDecompressSync(bytes, { maxOutputLength: CITY_BVPK_BLOCK_LIMIT });
const compress = (bytes: Uint8Array) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });

function writeVarint(output: number[], value: number) {
  while (value >= 128) {
    output.push((value % 128) + 128);
    value = Math.floor(value / 128);
  }
  output.push(value);
}

export function encodeBvpk(part: CityPart): Buffer {
  const frames: Buffer[] = [];
  const metadata = { ...part, lines: part.lines.map(line => {
    const { path, ...fields } = line;
    const frame = [0]; // BVP1 delta mode.
    writeVarint(frame, path.length);
    let previousX = 0, previousY = 0;
    for (const [lng, lat] of path) {
      const x = Math.round(lng * scale), y = Math.round(lat * scale);
      if (x / scale !== lng || y / scale !== lat) {
        frames.push(Buffer.from([0, 0]));
        return line;
      }
      writeVarint(frame, zigzag(x - previousX));
      writeVarint(frame, zigzag(y - previousY));
      previousX = x;
      previousY = y;
    }
    frames.push(Buffer.from(frame));
    return fields;
  }) };
  const lengths: number[] = [];
  writeVarint(lengths, frames.length);
  for (const frame of frames) writeVarint(lengths, frame.length);
  const geometry = Buffer.concat([Buffer.from('BVP1'), Buffer.from(lengths), ...frames]);
  const meta = compress(Buffer.from(JSON.stringify(metadata)));
  const geom = compress(geometry);
  const header = Buffer.from('BVPK1\0\0\0\0\0\0\0\0');
  header.writeUInt32LE(meta.length, 5);
  header.writeUInt32LE(geom.length, 9);
  return Buffer.concat([header, meta, geom]);
}

export function verifyNodeCityBvpkPart(part: CityBvpkPart, bytes: Uint8Array) {
  if (bytes.length !== part.bytes || sha256(bytes) !== part.sha256 || !parseBvpkHeader(bytes).valid) {
    throw Error('BVPK1: 分片校验失败。');
  }
}

export const readNodeCityBvpkPart = (part: CityBvpkPart, read: (path: string) => Promise<Uint8Array>) =>
  readCityBvpkPart(part, read, decompress, sha256);

interface CityBvpkFile { path: string; content: Buffer }

export async function packCitySnapshot(data: CityDataset, prefix: string, snapshotId: string, fileLimit = CITY_FILE_BYTES) {
  const { lines, stops, ...header } = data;
  const manifest: CityBvpkManifest = { storage: CITY_BVPK_FORMAT, snapshotId, header, parts: [] };
  const files: CityBvpkFile[] = [];
  let part: CityPart = { lines: [], stops: [] };
  let bytes = 24;
  const flush = async () => {
    const content = encodeBvpk(part);
    if (manifest.parts.length >= 256 || content.byteLength > CITY_BVPK_BLOCK_LIMIT) throw Error('BVPK1: 城市分片超过发布上限。');
    const descriptor = { bytes: content.length, sha256: sha256(content), lineCount: part.lines.length, stopCount: part.stops.length };
    const restored = await readNodeCityBvpkPart(descriptor, async () => content);
    if (!isDeepStrictEqual(restored, JSON.parse(JSON.stringify(part)))) throw Error('BVPK1: 城市分片无损校验失败。');
    manifest.parts.push(descriptor);
    files.push({ path: `${prefix}/${cityBvpkPartPath(descriptor)}`, content });
    part = { lines: [], stops: [] };
    bytes = 24;
  };
  for (const stop of stops) {
    const size = Buffer.byteLength(JSON.stringify(stop)) + 1;
    if (bytes + size > fileLimit && (part.lines.length || part.stops.length)) await flush();
    part.stops.push(stop);
    bytes += size;
  }
  for (const line of lines) {
    const size = Buffer.byteLength(JSON.stringify(line)) + 1;
    if (bytes + size > fileLimit && (part.lines.length || part.stops.length)) await flush();
    part.lines.push(line);
    bytes += size;
  }
  if (part.lines.length || part.stops.length) await flush();
  return { manifest, files };
}

export const openNodeBvpk = (bytes: Uint8Array) => openBvpk(bytes, decompress);
