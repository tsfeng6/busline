import type { BusLine } from '../types';
import { routeDistance, routeName } from './localTransit';
import { transitTileTransport } from './transitTileTransport';
import {
  TRANSIT_TILE_EXTENT, tileKey, tileLngLat, tilesInBounds, transitTileIndexed, validTransitTileIndex,
  type TransitPoint, type TransitTile, type TransitTileData,
} from './transitTiles';

export type NearbyTransitRoute = { city: string; line: Pick<BusLine, 'id' | 'name'>; distance: number };
export const NEARBY_TILE_RADIUS = 500;

export function nearbyTileRoutes(tiles: { tile: TransitTile; data: TransitTileData }[], center: TransitPoint): NearbyTransitRoute[] {
  const routes = new Map<string, NearbyTransitRoute>();
  for (const { tile, data } of tiles) {
    for (const route of data.routes) {
      let distance = Infinity;
      for (const points of route.paths) {
        const path: TransitPoint[] = [];
        for (let i = 0; i < points.length; i += 2) {
          path.push(tileLngLat([tile.x + points[i] / TRANSIT_TILE_EXTENT, tile.y + points[i + 1] / TRANSIT_TILE_EXTENT], tile.z));
        }
        distance = Math.min(distance, routeDistance(path, center));
      }
      if (distance > NEARBY_TILE_RADIUS) continue;
      const key = `${route.city}\0${routeName(route.name)}`;
      if (!routes.has(key) || distance < routes.get(key)!.distance) {
        routes.set(key, { city: route.city, line: { id: route.id, name: route.name }, distance });
      }
    }
  }
  return [...routes.values()].sort((a, b) => a.distance - b.distance);
}

export async function loadNearbyTransitTiles(position: TransitPoint, signal: AbortSignal) {
  const base = import.meta.env.BASE_URL;
  const response = await fetch(`${base}city-data/v1/transit.json`, { signal, cache: 'no-cache', redirect: 'error' });
  if (!response.ok) throw Error('Transit index unavailable');
  const index = await response.json();
  if (index.schemaVersion !== 1 || !validTransitTileIndex(index)) throw Error('Invalid transit index');
  signal.throwIfAborted();
  const [lng, lat] = position;
  const dy = NEARBY_TILE_RADIUS / 111000, dx = dy / Math.max(.1, Math.cos(lat * Math.PI / 180));
  const tiles = tilesInBounds([lng - dx, lat - dy, lng + dx, lat + dy], 15).filter(transitTileIndexed(index));
  const transport = transitTileTransport(index, base);
  try {
    const loaded: { tile: TransitTile; data: TransitTileData }[] = [];
    let failed = 0;
    for (let i = 0; i < tiles.length; i += 3) {
      signal.throwIfAborted();
      const batch = await Promise.allSettled(tiles.slice(i, i + 3).map(async tile => ({ tile, data: await transport.load(tileKey(tile), signal) })));
      for (const result of batch) {
        if (result.status === 'fulfilled') loaded.push(result.value);
        else failed++;
      }
    }
    signal.throwIfAborted();
    return { lines: nearbyTileRoutes(loaded, position), failed };
  } finally {
    transport.stop();
  }
}
