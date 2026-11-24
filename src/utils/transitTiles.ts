import { CITY_DETAIL_ZOOM, mercatorY } from './cityOverview';

export const TIMELINE_TILE_ZOOM = 10;
export const TIMELINE_OVERVIEW_ZOOM = 9;
export const TRANSIT_TILE_LEVELS = [TIMELINE_TILE_ZOOM, 13, 15] as const;
export const TRANSIT_TILE_EXTENT = 4096;
export const TRANSIT_TILE_BASE = 'tiles/transit-v1';
export const MAX_TRANSIT_TILE_BYTES = 12 * 1024 * 1024;
export type TransitPoint = [number, number];
export type TransitBounds = [west: number, south: number, east: number, north: number];
export type TransitTile = { z: number; x: number; y: number };
/** Compact route metadata needed by the viewport card. Geometry stays tile-local. */
export type TileRoute = {
  city: string;
  id: string;
  name: string;
  stime?: string;
  etime?: string;
  paths: Float32Array[];
};
export type TileStop = {
  city: string; id: string; name: string; x: number; y: number;
  address: string; lines: string[]; terminal: boolean;
};
export type TransitTileData = { routes: TileRoute[]; stops: TileStop[]; bytes: number };
export const MAX_TRANSIT_PACK_BYTES = 2 * 1024 * 1024;
export type TimelineCity = { city: string; center: TransitPoint; hours: [first: string, last: string, directions: number][] };
export type TransitTileIndex = {
  base: string; revision: string; groups: Record<string, [mask: string, digest: string]>;
  timelineCities?: TimelineCity[];
};

export const tileKey = ({ z, x, y }: TransitTile) => `${z}/${x}/${y}`;
export const tileCoordinates = ([lng, lat]: TransitPoint, z: number): TransitPoint => {
  const scale = 2 ** z;
  return [(lng + 180) / 360 * scale, (180 - mercatorY(lat)) / 360 * scale];
};
export const tileLngLat = ([x, y]: TransitPoint, z: number): TransitPoint => {
  const scale = 2 ** z;
  return [x / scale * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI];
};
export function tileAncestor(tile: TransitTile, z: number): TransitTile {
  const scale = 2 ** (tile.z - z);
  return { z, x: Math.floor(tile.x / scale), y: Math.floor(tile.y / scale) };
}

const transitPackWidth = (z: number) => z === TIMELINE_TILE_ZOOM ? 1 : z === 13 ? 4 : 8;

export function transitPackLocation(tile: TransitTile) {
  const width = transitPackWidth(tile.z);
  const group = tileAncestor(tile, tile.z - Math.log2(width));
  return {
    key: tileKey({ z: tile.z, x: group.x, y: group.y }),
    slot: (tile.y % width) * width + tile.x % width,
    slots: width * width,
  };
}

export function validTransitTileIndex(value: any): value is TransitTileIndex {
  if (value?.base !== TRANSIT_TILE_BASE || !/^[a-f0-9]{40}$/.test(value.revision)
    || !value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups)) return false;
  if (value.timelineCities !== undefined && (!Array.isArray(value.timelineCities) || value.timelineCities.length > 1000
    || !value.timelineCities.every((entry: TimelineCity) =>
      typeof entry?.city === 'string' && Array.isArray(entry.center) && entry.center.length === 2 && entry.center.every(Number.isFinite)
      && Array.isArray(entry.hours) && entry.hours.every(slot =>
        Array.isArray(slot) && slot.length === 3 && /^\d{2}:\d{2}$/.test(slot[0]) && /^\d{2}:\d{2}$/.test(slot[1])
        && Number.isSafeInteger(slot[2]) && slot[2] > 0)))) return false;
  const entries = Object.entries(value.groups);
  return entries.length <= 50000 && entries.every(([key, entry]) => {
    if (!/^(10|13|15)\/\d+\/\d+$/.test(key) || !Array.isArray(entry) || entry.length !== 2) return false;
    const [z, x, y] = key.split('/').map(Number);
    const width = transitPackWidth(z), side = 2 ** z / width;
    return x < side && y < side && typeof entry[0] === 'string'
      && entry[0].length === Math.max(1, width * width / 4) && /^[a-f0-9]+$/.test(entry[0])
      && /^[a-f0-9]{16}$/.test(entry[1]);
  });
}

export function transitTileIndexed(index: TransitTileIndex) {
  const masks = new Map(Object.entries(index.groups).map(([key, [mask]]) => [key, BigInt('0x' + mask)]));
  return (tile: TransitTile) => {
    const { key, slot } = transitPackLocation(tile);
    const mask = masks.get(key);
    return mask !== undefined && (mask & (1n << BigInt(slot))) !== 0n;
  };
}

export function transitPackTile(pack: Uint8Array, slot: number, slots: number) {
  const header = slots * 8;
  if (pack.byteLength < header || slot < 0 || slot >= slots) throw Error('Truncated transit pack');
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const start = view.getUint32(slot * 8, true), length = view.getUint32(slot * 8 + 4, true);
  if (start < header || !length || start + length > pack.byteLength) throw Error('Invalid transit pack tile');
  return pack.subarray(start, start + length);
}

/** Centre-first selection in projected coordinates, including wrap at the date line. */
export function tilesInBounds(bounds: TransitBounds, z: number, padding = 0): TransitTile[] {
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite) || north < south) return [];
  const [left, top] = tileCoordinates([west, north], z);
  let [right, bottom] = tileCoordinates([east, south], z);
  const size = 2 ** z;
  if (right < left) right += size;
  const startX = Math.floor(left) - padding, endX = Math.floor(right) + padding;
  const startY = Math.max(0, Math.floor(top) - padding), endY = Math.min(size - 1, Math.floor(bottom) + padding);
  // A transient SDK bounds value during a level change must not enumerate the world.
  if ((endX - startX + 1) * (endY - startY + 1) > 256 || endX < startX) return [];
  const tiles: { tile: TransitTile; distance: number }[] = [];
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      tiles.push({ tile: { z, x: ((x % size) + size) % size, y },
        distance: (x + .5 - (left + right) / 2) ** 2 + (y + .5 - (top + bottom) / 2) ** 2 });
    }
  }
  return tiles.sort((a, b) => a.distance - b.distance).map(({ tile }) => tile);
}

export function transitLevel(zoom: number): number | null {
  if (zoom < CITY_DETAIL_ZOOM) return null;
  return zoom < 15 ? 13 : 15;
}

export function timelineTransitLevel(zoom: number, hasOverviewTiles: boolean): number | null {
  if (!hasOverviewTiles) return transitLevel(zoom);
  if (zoom < TIMELINE_OVERVIEW_ZOOM) return null;
  return transitLevel(zoom) ?? TIMELINE_TILE_ZOOM;
}

/** An indexed child can use its cached parent while its own data is pending. */
export function transitTileSource(tile: TransitTile, indexed: (tile: TransitTile) => boolean, cached: (key: string) => boolean, timeline = false): TransitTile | null {
  const key = tileKey(tile);
  if (cached(key)) return tile;
  if (!indexed(tile)) return null;
  for (const level of timeline ? [13, TIMELINE_TILE_ZOOM] : [13]) {
    if (level >= tile.z) continue;
    const parent = tileAncestor(tile, level);
    if (cached(tileKey(parent))) return parent;
  }
  return null;
}
