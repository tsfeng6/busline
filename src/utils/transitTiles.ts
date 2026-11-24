import { CITY_DETAIL_ZOOM, mercatorY } from './cityOverview';

export const TRANSIT_TILE_LEVELS = [13, 15] as const;
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
export type TransitTileIndex = { base: string; revision: string; groups: Record<string, [mask: string, digest: string]> };

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

export function transitPackLocation(tile: TransitTile) {
  const width = tile.z === 13 ? 4 : 8;
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
  const entries = Object.entries(value.groups);
  return entries.length <= 50000 && entries.every(([key, entry]) => {
    if (!/^(13|15)\/\d+\/\d+$/.test(key) || !Array.isArray(entry) || entry.length !== 2) return false;
    const [z, x, y] = key.split('/').map(Number), side = 2 ** (z - (z === 13 ? 2 : 3));
    return x < side && y < side && typeof entry[0] === 'string'
      && (z === 13 ? /^[a-f0-9]{4}$/ : /^[a-f0-9]{16}$/).test(entry[0])
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

/** An indexed child can use its cached parent while its own data is pending. */
export function transitTileSource(tile: TransitTile, indexed: (tile: TransitTile) => boolean, cached: (key: string) => boolean): TransitTile | null {
  const key = tileKey(tile);
  if (cached(key)) return tile;
  if (tile.z === 13 || !indexed(tile)) return null;
  const parent = tileAncestor(tile, 13);
  return cached(tileKey(parent)) ? parent : null;
}
