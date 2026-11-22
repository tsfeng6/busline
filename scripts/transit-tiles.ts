import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { CityDataset } from '../src/utils/cityDataset';
import {
  MAX_TRANSIT_PACK_BYTES, MAX_TRANSIT_TILE_BYTES, TRANSIT_TILE_BASE, TRANSIT_TILE_EXTENT, TRANSIT_TILE_LEVELS,
  tileCoordinates, tileKey, transitPackLocation, type TransitPoint,
} from '../src/utils/transitTiles';

function compactPath(path: TransitPoint[], tolerance: number): number[] {
  if (!tolerance || path.length < 3) return path.flat();
  const kept = new Uint8Array(path.length);
  const ranges: [number, number][] = [];
  // Cap the work per simplification window, including for runs that repeat in one tile.
  for (let first = 0; first < path.length - 1; first += 256) {
    const last = Math.min(path.length - 1, first + 256);
    kept[first] = kept[last] = 1;
    ranges.push([first, last]);
  }
  while (ranges.length) {
    const [first, last] = ranges.pop()!;
    const [ax, ay] = path[first], [bx, by] = path[last];
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    let farthest = first, max = tolerance ** 2;
    for (let i = first + 1; i < last; i++) {
      const [x, y] = path[i];
      const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
      const distance = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
      if (distance > max) { max = distance; farthest = i; }
    }
    if (farthest !== first) {
      kept[farthest] = 1;
      ranges.push([first, farthest], [farthest, last]);
    }
  }
  return path.filter((_, i) => kept[i]).flat();
}

const local = (value: number, origin: number) => Math.round((value - origin) * TRANSIT_TILE_EXTENT);

/** Split every segment at grid intersections. Remote endpoints and administrative bounds are irrelevant. */
export function tileRoutePaths(path: TransitPoint[], z: number): Map<string, number[][]> {
  const cells = new Map<string, TransitPoint[][]>();
  let lastKey = '', run: TransitPoint[] = [];
  const points = path.map(point => tileCoordinates(point, z));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if ((!dx && !dy) || Math.abs(dx) > 2 ** (z - 1)) { lastKey = ''; continue; }
    const cuts = [0, 1];
    for (let axis = 0; axis < 2; axis++) {
      const start = a[axis], end = b[axis];
      for (let edge = Math.floor(Math.min(start, end)) + 1; edge < Math.max(start, end); edge++) {
        cuts.push((edge - start) / (end - start));
      }
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) {
      const start = cuts[j - 1], end = cuts[j];
      if (end - start < 1e-12) continue;
      const middle = (start + end) / 2;
      const x = Math.floor(a[0] + middle * dx), y = Math.floor(a[1] + middle * dy);
      if (x < 0 || x >= 2 ** z || y < 0 || y >= 2 ** z) { lastKey = ''; continue; }
      const key = tileKey({ z, x, y });
      const from: TransitPoint = [local(a[0] + start * dx, x), local(a[1] + start * dy, y)];
      const to: TransitPoint = [local(a[0] + end * dx, x), local(a[1] + end * dy, y)];
      if (key !== lastKey) {
        const paths = cells.get(key) ?? [];
        run = [from];
        paths.push(run);
        cells.set(key, paths);
        lastKey = key;
      }
      const last = run.at(-1)!;
      if (last[0] !== to[0] || last[1] !== to[1]) run.push(to);
    }
  }
  const output = new Map<string, number[][]>();
  for (const [key, runs] of cells) {
    const paths = runs.filter(run => run.length > 1).map(run => compactPath(run, z === 13 ? 9 : 0));
    if (paths.length) output.set(key, paths);
  }
  return output;
}

export class TransitTilePublisher {
  private keys = new Set<string>();

  constructor(private directory: string) {}

  add(data: CityDataset) {
    const stops = new Map<string, { id: string; name: string; lng: number; lat: number; address: string; lines: Set<string>; terminal: boolean }>();
    const stopKey = (name: string, lng: number, lat: number) => `${name}\0${lng},${lat}`;
    for (const stop of data.stops ?? []) {
      const { lng, lat } = stop.location;
      const address = stop.address ?? '';
      if (!stop.name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      stops.set(stopKey(stop.name, lng, lat), { id: stop.id ?? '', name: stop.name, lng, lat, address,
        lines: new Set(address.split(/[;；]/).map(name => name.trim()).filter(Boolean)), terminal: /终点站|总站/.test(stop.name) });
    }
    for (const line of data.lines ?? []) {
      if (!line.name) continue;
      const via = line.via_stops ?? [];
      for (let i = 0; i < via.length; i++) {
        const { id, name, location: { lng, lat } } = via[i];
        if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const key = stopKey(name, lng, lat);
        const stop = stops.get(key) ?? { id: id ?? '', name, lng, lat, address: '', lines: new Set<string>(), terminal: false };
        stop.lines.add(line.name);
        stop.terminal ||= i === 0 || i === via.length - 1;
        stops.set(key, stop);
      }
    }
    for (const z of TRANSIT_TILE_LEVELS) {
      const records = new Map<string, string[]>();
      const add = (key: string, record: unknown) => {
        const list = records.get(key) ?? [];
        list.push(JSON.stringify(record));
        records.set(key, list);
      };
      for (const line of data.lines ?? []) {
        if (!line.name || !line.path?.length) continue;
        // Keep the two compact display times with the tile. The viewport deliberately
        // avoids a second AMap request after a map click, so dropping these fields
        // makes an otherwise complete route look like it has no operating hours.
        for (const [key, paths] of tileRoutePaths(line.path, z)) {
          add(key, [0, data.city, line.id ?? '', line.name, line.stime ?? '', line.etime ?? '', paths]);
        }
      }
      for (const stop of stops.values()) {
        const [px, py] = tileCoordinates([stop.lng, stop.lat], z);
        const x = Math.floor(px), y = Math.floor(py);
        if (x < 0 || x >= 2 ** z || y < 0 || y >= 2 ** z) continue;
        add(tileKey({ z, x, y }), [1, data.city, stop.id, stop.name, local(px, x), local(py, y), stop.address, [...stop.lines], stop.terminal]);
      }
      for (const [key, lines] of records) {
        const path = join(this.directory, key + '.ndjson');
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, lines.join('\n') + '\n');
        this.keys.add(key);
      }
    }
  }

  /**
   * Reuse one city's already-expanded tile contribution.  Contributions are
   * deliberately kept separate until this point: two neighbouring cities can
   * therefore safely share a tile without either city overwriting the other.
   */
  addDirectory(directory: string, onlyGroups?: ReadonlySet<string>) {
    if (!existsSync(directory)) throw Error(`Missing transit contribution: ${directory}`);
    const visit = (dir: string, relative = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const next = relative ? `${relative}/${entry.name}` : entry.name;
        const source = join(dir, entry.name);
        if (entry.isDirectory()) visit(source, next);
        else if (entry.isFile() && next.endsWith('.ndjson')) {
          const key = next.slice(0, -'.ndjson'.length);
          const [z, x, y] = key.split('/').map(Number);
          if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) throw Error(`Invalid transit contribution key: ${next}`);
          const group = transitPackLocation({ z, x, y }).key;
          if (onlyGroups && !onlyGroups.has(group)) continue;
          const target = join(this.directory, `${key}.ndjson`);
          mkdirSync(dirname(target), { recursive: true });
          appendFileSync(target, readFileSync(source));
          this.keys.add(key);
        }
      }
    };
    visit(directory);
  }

  groups(): Set<string> {
    const groups = new Set<string>();
    for (const key of this.keys) {
      const [z, x, y] = key.split('/').map(Number);
      groups.add(transitPackLocation({ z, x, y }).key);
    }
    return groups;
  }

  *files(onlyGroups?: ReadonlySet<string>) {
    const groups = new Map<string, { key: string; slot: number; slots: number }[]>();
    for (const key of this.keys) {
      const [z, x, y] = key.split('/').map(Number);
      const group = transitPackLocation({ z, x, y });
      const tiles = groups.get(group.key) ?? [];
      tiles.push({ key, slot: group.slot, slots: group.slots });
      groups.set(group.key, tiles);
    }
    if (groups.size > 50000) throw Error('Transit tile index exceeds publication budget');
    for (const group of [...groups.keys()].sort()) {
      if (onlyGroups && !onlyGroups.has(group)) continue;
      const tiles = groups.get(group)!.sort((a, b) => a.slot - b.slot);
      const slots = tiles[0].slots, header = Buffer.alloc(slots * 8);
      let offset = header.length, mask = 0n;
      const payloads = [header];
      for (const { key, slot } of tiles) {
        const raw = readFileSync(join(this.directory, key + '.ndjson'));
        if (raw.byteLength > MAX_TRANSIT_TILE_BYTES) throw Error(`Transit tile exceeds decode budget: ${key}`);
        const content = gzipSync(raw, { level: 6 });
        header.writeUInt32LE(offset, slot * 8);
        header.writeUInt32LE(content.byteLength, slot * 8 + 4);
        mask |= 1n << BigInt(slot);
        offset += content.byteLength;
        payloads.push(content);
      }
      if (offset > MAX_TRANSIT_PACK_BYTES) throw Error(`Transit pack exceeds network budget: ${group}`);
      const content = Buffer.concat(payloads, offset);
      const digest = createHash('sha256').update(content).digest('hex').slice(0, 16);
      yield {
        key: group, descriptor: [mask.toString(16).padStart(slots / 4, '0'), digest] as [string, string],
        path: `city-data/v1/${TRANSIT_TILE_BASE}/${group}-${digest}.pack`, content,
      };
    }
  }
}
