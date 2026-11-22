import { useEffect, useRef } from 'react';
import { validTileIndex } from '../utils/cityOverview';

const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function CityOverviewLayer({ map, enabled, detailReady }: { map: any; enabled: boolean; detailReady: boolean }) {
  const layerRef = useRef<any>(null);
  const detail = useRef(detailReady);
  detail.current = detailReady;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (!detailReady) { layer.setOpacity(.8); return; }
    let frame: number;
    const start = performance.now();
    const fade = (now: number) => {
      const remaining = Math.max(0, 1 - (now - start) / 140);
      layer.setOpacity(remaining * .8);
      if (remaining > 0) frame = requestAnimationFrame(fade);
    };
    frame = requestAnimationFrame(fade);
    return () => cancelAnimationFrame(frame);
  }, [detailReady]);
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
      layer = new AMap.TileLayer({
        getTileUrl(x: number, y: number, z: number) {
          const key = `${z}/${x}/${y}`;
          return keys.has(key) ? `${import.meta.env.BASE_URL}city-data/v1/${index.base}/${key}.png?v=${index.revision}&q=hd2` : EMPTY_TILE;
        },
        tileSize: 256,
        zooms: [2, 30],
        dataZooms: [index.minZoom, index.maxZoom],
        zIndex: 4,
        opacity: detail.current ? 0 : .8,
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
