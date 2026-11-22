import { useEffect, useRef, type MutableRefObject } from 'react';
import { TransitTileCache } from '../utils/transitTileCache';
import { transitTileTransport } from '../utils/transitTileTransport';
import {
  TRANSIT_TILE_EXTENT as EXTENT, tileKey, tileLngLat, tileAncestor, tilesInBounds, transitLevel,
  transitTileSource, transitTileIndexed, validTransitTileIndex, type TileRoute, type TileStop, type TransitTileData, type TransitBounds, type TransitPoint, type TransitTile,
} from '../utils/transitTiles';

export type ViewportStop = TileStop & { location: { lng: number; lat: number }; key: string; isBusStop: true };
export type ViewportRoute = Pick<TileRoute, 'city' | 'id' | 'name'>;
export type ViewportTransitSelection = {
  stops(): ViewportStop[];
  routesAt(point: TransitPoint): ViewportRoute[];
};

type Options = {
  map: any;
  enabled: boolean;
  stationMode: 'all' | 'terminal' | 'none';
  thick: boolean;
  stationLineStats: boolean;
  subdued: boolean;
  blocked: (name: string) => boolean;
  selection: MutableRefObject<ViewportTransitSelection | null>;
  onStats: (stats: { lines: number; stops: number }) => void;
  onDetailReady: (ready: boolean) => void;
};

export function ViewportTransitLayer({ map, enabled, selection, ...style }: Options) {
  const options = useRef(style);
  options.current = style;
  const repaint = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { repaint.current?.(); }, [style.stationMode, style.thick, style.subdued, style.blocked, style.stationLineStats]);

  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!map || !enabled || !AMap?.CustomLayer || typeof Worker === 'undefined') return;
    const controller = new AbortController();
    let cleanup: (() => void) | undefined;
    void fetch(`${import.meta.env.BASE_URL}city-data/v1/transit.json`, {
      signal: controller.signal, cache: 'no-cache', redirect: 'error',
    }).then(response => {
      if (!response.ok) throw Error('Transit index unavailable');
      return response.json();
    }).then(index => {
      if (controller.signal.aborted || index.schemaVersion !== 1 || !validTransitTileIndex(index)) return;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.style.pointerEvents = 'none';
      const transport = transitTileTransport(index, import.meta.env.BASE_URL);
      const indexed = transitTileIndexed(index);
      const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) <= 4;
      const cache = new TransitTileCache(transport.load, schedulePaint, (lowMemory ? 12 : 28) * 1024 ** 2, lowMemory ? 3 : 5);
      const layer = new AMap.CustomLayer(canvas, { zIndex: 5, zooms: [2, 30] });
      const routePaths = new WeakMap<TransitTileData, { blocked: Options['blocked']; path: Path2D; names: string[] }>();
      let settled: ReturnType<typeof setTimeout>, idle: ReturnType<typeof setTimeout>, retry: ReturnType<typeof setTimeout>;
      let frame = 0;
      let lastStats = '';
      let visibleStops: ViewportStop[] = [];
      let moving = false;

      function bounds(): TransitBounds | undefined {
        const b = map.getBounds?.();
        const sw = b?.getSouthWest(), ne = b?.getNorthEast();
        if (sw && ne) return [sw.lng, sw.lat, ne.lng, ne.lat];
      }
      function sources() {
        const b = bounds(), z = transitLevel(map.getZoom());
        if (!b || z === null) return [];
        return tilesInBounds(b, z).flatMap(cell => {
          const source = transitTileSource(cell, indexed, key => cache.has(key));
          const data = source && cache.get(tileKey(source));
          return source && data ? [{ cell, source, data }] : [];
        });
      }
      function tilePosition(tile: TransitTile) {
        const origin = map.lngLatToContainer(tileLngLat([tile.x, tile.y], tile.z));
        const east = map.lngLatToContainer(tileLngLat([tile.x + 1, tile.y], tile.z));
        const south = map.lngLatToContainer(tileLngLat([tile.x, tile.y + 1], tile.z));
        return { origin, east, south };
      }
      function schedulePaint() {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; paint(); });
      }
      function paint() {
        const context = ctx!;
        const { width, height } = map.getSize();
        const ratio = Math.min(devicePixelRatio || 1, lowMemory ? 1.5 : 2);
        const w = Math.round(width * ratio), h = Math.round(height * ratio);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h;
          canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        const settings = options.current;
        context.globalAlpha = settings.subdued ? .24 : .93;
        context.strokeStyle = '#52796f';
        context.lineCap = 'round';
        context.lineJoin = 'round';
        const routes = new Set<string>(), stops = new Map<string, ViewportStop>();
        const stationPaths = new Map<string, Path2D>();
        const tiles = sources();
        for (const { cell, source, data } of tiles) {
          const { origin, east, south } = tilePosition(source);
          const scale = Math.hypot(east.x - origin.x, east.y - origin.y) / EXTENT;
          if (!Number.isFinite(scale) || scale <= 0) continue;
          context.save();
          context.transform((east.x - origin.x) / EXTENT, (east.y - origin.y) / EXTENT,
            (south.x - origin.x) / EXTENT, (south.y - origin.y) / EXTENT, origin.x, origin.y);
          const factor = 2 ** (cell.z - source.z);
          const size = EXTENT / factor, x = (cell.x % factor) * size, y = (cell.y % factor) * size;
          context.beginPath();
          context.rect(x, y, size, size);
          context.clip();
          context.lineWidth = (settings.thick ? 2.8 : 1.65) / scale;
          let geometry = routePaths.get(data);
          if (!geometry || geometry.blocked !== settings.blocked) {
            const path = new Path2D(), names: string[] = [];
            for (const route of data.routes) {
              if (settings.blocked(route.name)) continue;
              names.push(`${route.city}\0${route.name.split(/[（(]/)[0]}`);
              for (const points of route.paths) {
                path.moveTo(points[0], points[1]);
                for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
              }
            }
            geometry = { path, names, blocked: settings.blocked };
            routePaths.set(data, geometry);
          }
          geometry.names.forEach(name => routes.add(name));
          context.stroke(geometry.path);
          context.restore();
          if (settings.stationMode === 'none') continue;
          const dx = east.x - origin.x, dy = east.y - origin.y;
          const sx = south.x - origin.x, sy = south.y - origin.y;
          for (const stop of data.stops) {
            if (settings.stationMode === 'terminal' && !stop.terminal) continue;
            if (stop.x < x || stop.x > x + size || stop.y < y || stop.y > y + size) continue;
            const px = origin.x + (dx * stop.x + sx * stop.y) / EXTENT;
            const py = origin.y + (dy * stop.x + sy * stop.y) / EXTENT;
            if (px < -5 || py < -5 || px > width + 5 || py > height + 5) continue;
            const lines = stop.lines.filter(name => !settings.blocked(name));
            if (stop.lines.length && !lines.length) continue;
            const [lng, lat] = tileLngLat([source.x + stop.x / EXTENT, source.y + stop.y / EXTENT], source.z);
            const key = `tile:${stop.city}:${stop.id}:${stop.name}:${lng.toFixed(5)},${lat.toFixed(5)}`;
            if (stops.has(key)) continue;
            stops.set(key, { ...stop, lines, location: { lng, lat }, key, isBusStop: true });
            const color = settings.stationMode === 'terminal' ? '#52525b'
              : settings.stationLineStats && lines.length ? lines.length <= 2 ? '#5e8271' : lines.length <= 6 ? '#c29b63' : '#b56666' : '#3576bc';
            const radius = settings.stationMode === 'terminal' ? 8 : map.getZoom() >= 15 ? 6 : 4;
            const path = stationPaths.get(color) ?? new Path2D();
            path.moveTo(px + radius, py);
            path.arc(px, py, radius, 0, 2 * Math.PI);
            stationPaths.set(color, path);
          }
        }
        for (const [color, path] of stationPaths) {
          context.fillStyle = color;
          context.fill(path);
        }
        const b = bounds(), z = transitLevel(map.getZoom());
        const expected = b && z !== null ? tilesInBounds(b, z).filter(indexed) : [];
        settings.onDetailReady(!moving && expected.length > 0 && expected.every(tile => cache.has(tileKey(tile))));
        visibleStops = [...stops.values()];
        const stats = `${routes.size}/${stops.size}`;
        if (lastStats !== stats) {
          lastStats = stats;
          settings.onStats({ lines: routes.size, stops: stops.size });
        }
      }

      function request(allowNeighbors: boolean) {
        const b = bounds(), zoom = map.getZoom(), z = transitLevel(zoom);
        if (!b || z === null) { cache.update([], []); return; }
        const foreground = tilesInBounds(b, z).filter(indexed).map(tileKey);
        const candidates = tilesInBounds(b, z, 1);
        const neighbors = new Set(candidates.filter(indexed).map(tileKey));
        if (z === 15) candidates.map(tile => tileAncestor(tile, 13)).filter(indexed).forEach(tile => neighbors.add(tileKey(tile)));
        foreground.forEach(key => neighbors.delete(key));
        cache.update(foreground, [...neighbors].slice(0, lowMemory ? 10 : 20), allowNeighbors);
      }

      function start() {
        clearTimeout(settled);
        clearTimeout(idle);
        clearTimeout(retry);
        moving = true;
        options.current.onDetailReady(false);
        // Let the SDK transform the last frame while the viewport is moving.
        cache.pause();
      }
      function end() {
        moving = false;
        schedulePaint();
        clearTimeout(settled);
        clearTimeout(idle);
        clearTimeout(retry);
        settled = setTimeout(() => request(false), 75);
        idle = setTimeout(() => request(true), 350);
        const retryVisible = () => { request(false); retry = setTimeout(retryVisible, 11000); };
        if (transitLevel(map.getZoom()) !== null) retry = setTimeout(retryVisible, 11000);
      }

      selection.current = {
        stops: () => visibleStops,
        routesAt(point) {
          const p = map.lngLatToContainer(point), matches = new Map<string, ViewportRoute>();
          const z = transitLevel(map.getZoom());
          if (z === null) return [];
          // A small hit box includes the neighboring tile at a seam.
          for (const { source, data } of sources()) {
            const { origin, east, south } = tilePosition(source);
            const dx = east.x - origin.x, dy = east.y - origin.y;
            const sx = south.x - origin.x, sy = south.y - origin.y;
            const determinant = dx * sy - dy * sx;
            if (!determinant) continue;
            const px = p.x - origin.x, py = p.y - origin.y;
            const x = (px * sy - py * sx) * EXTENT / determinant;
            const y = (py * dx - px * dy) * EXTENT / determinant;
            const tolerance = 7 * EXTENT / Math.hypot(dx, dy);
            if (x < -tolerance || y < -tolerance || x > EXTENT + tolerance || y > EXTENT + tolerance) continue;
            for (const route of data.routes) {
              if (!options.current.blocked(route.name) && route.paths.some(path => pathNear(path, x, y, tolerance))) {
                matches.set(`${route.city}\0${route.id || route.name}`, { city: route.city, id: route.id, name: route.name });
              }
            }
          }
          return [...matches.values()];
        },
      };
      repaint.current = schedulePaint;
      layer.render = paint;
      map.add(layer);
      const starts = ['movestart', 'zoomstart'];
      const ends = ['moveend', 'zoomend', 'resize'];
      starts.forEach(event => map.on(event, start));
      ends.forEach(event => map.on(event, end));
      end();
      cleanup = () => {
        starts.forEach(event => map.off(event, start));
        ends.forEach(event => map.off(event, end));
        layer.render = () => {};
        map.remove(layer);
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove();
        clearTimeout(settled);
        clearTimeout(idle);
        clearTimeout(retry);
        cancelAnimationFrame(frame);
        cache.dispose();
        transport.stop();
        repaint.current = undefined;
        selection.current = null;
        options.current.onDetailReady(false);
        options.current.onStats({ lines: 0, stops: 0 });
      };
    }).catch(() => {});
    return () => { controller.abort(); cleanup?.(); };
  }, [map, enabled, selection]);

  return null;
}

function pathNear(path: Float32Array, x: number, y: number, tolerance: number) {
  for (let i = 2; i < path.length; i += 2) {
    const ax = path[i - 2], ay = path[i - 1], dx = path[i] - ax, dy = path[i + 1] - ay;
    const sq = dx * dx + dy * dy;
    const t = sq ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / sq)) : 0;
    if ((ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2 <= tolerance ** 2) return true;
  }
  return false;
}
