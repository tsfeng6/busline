import { useEffect, useRef } from 'react';
import { validTileIndex } from '../utils/cityOverview';

const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const OVERVIEW_OPACITY = .8;

export function CityOverviewLayer({ map, enabled, detailReady }: { map: any; enabled: boolean; detailReady: boolean }) {
  const layerRef = useRef<any>(null);
  const opacity = useRef(OVERVIEW_OPACITY);
  const detail = useRef(detailReady);
  detail.current = detailReady;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (!detailReady) {
      opacity.current = OVERVIEW_OPACITY;
      layer.setOpacity(opacity.current);
      return;
    }
    const from = opacity.current;
    if (!from) return;
    let frame: number;
    const start = performance.now();
    const fade = (now: number) => {
      const remaining = Math.max(0, 1 - (now - start) / 140);
      opacity.current = remaining * from;
      layer.setOpacity(opacity.current);
      if (remaining > 0) frame = requestAnimationFrame(fade);
    };
    frame = requestAnimationFrame(fade);
    return () => cancelAnimationFrame(frame);
  }, [detailReady, map, enabled]);
  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!map || !enabled || !AMap?.TileLayer) return;
    const controller = new AbortController();
    let layer: any;
    void fetch(`${import.meta.env.BASE_URL}city-data/v1/overview.json?v=xyz-hd2`, {
      signal: controller.signal, cache: 'no-cache', redirect: 'error',
    }).then(response => {
      if (!response.ok) throw Error('Overview unavailable');
      return response.json();
    }).then(data => {
      if (controller.signal.aborted || data.schemaVersion !== 3 || !validTileIndex(data.tiles)) return;
      const index = data.tiles;
      const keys = new Set(index.keys);
      opacity.current = detail.current ? 0 : OVERVIEW_OPACITY;
      layer = new AMap.TileLayer({
        getTileUrl(x: number, y: number, z: number) {
          const key = `${z}/${x}/${y}`;
          return keys.has(key) ? `${import.meta.env.BASE_URL}city-data/v1/${index.base}/${key}.png?v=${index.revision}&q=hd2` : EMPTY_TILE;
        },
        tileSize: 256,
        zooms: [2, 30],
        dataZooms: [index.minZoom, index.maxZoom],
        zIndex: 4,
        opacity: opacity.current,
      });
      layerRef.current = layer;
      map.add(layer);
    }).catch(() => {});
    return () => {
      controller.abort();
      if (layer) map.remove(layer);
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [map, enabled]);
  return null;
}
