/** Keep station data cheap. AMap objects exist only while the station is in view. */
export function lazyStopMarker(AMap: any, initial: any) {
  let options = { ...initial }, marker: any = null, style = '';
  const listeners: [string, (...args: any[]) => void][] = [];
  const descriptor = {
    lazy: true,
    on(event: string, callback: (...args: any[]) => void) { listeners.push([event, callback]); return descriptor; },
    getExtData: () => options.extData,
    getCenter: () => ({ lng: options.center[0], lat: options.center[1] }),
    setOptions(next: any) {
      const key = JSON.stringify(next); if (key === style) return;
      style = key; options = { ...options, ...next }; marker?.setOptions(next);
    },
    materialize() {
      if (!marker) { marker = new AMap.CircleMarker(options); marker.__lazyOwner = descriptor; for (const [event, callback] of listeners) marker.on(event, callback); }
      return marker;
    },
    release() {
      if (!marker) return;
      for (const [event, callback] of listeners) marker.off?.(event, callback);
      marker.setMap?.(null); marker.destroy?.(); marker = null;
    },
  };
  return descriptor;
}
/** Screen-density decluttering only affects symbols; all station/route data stays intact. */
export function viewportStopMarkers(markers: any[], map: any) {
  const bounds = map.getBounds?.(); if (!bounds) return markers;
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast(), zoom = map.getZoom();
  const padding = .05 * Math.max(ne.lng - sw.lng, ne.lat - sw.lat);
  const cells = new Set<string>(), unit = 360 / (256 * 2 ** zoom) * 24;
  const latitude = Math.cos((sw.lat + ne.lat) / 2 * Math.PI / 180);
  return markers.filter(marker => {
    const p = marker.getCenter?.() || marker.getPosition?.();
    if (!p) return true;
    const lng = p.lng ?? p.getLng(), lat = p.lat ?? p.getLat();
    if (lng < sw.lng - padding || lng > ne.lng + padding || lat < sw.lat - padding || lat > ne.lat + padding) return false;
    if (zoom >= 16) return true;
    const key = `${Math.floor(lng / unit)},${Math.floor(lat / (unit * latitude))}`;
    if (cells.has(key)) return false; cells.add(key); return true;
  });
}
export function syncLazyMarkers(group: any, descriptors: any[]) {
  const previous = group.getOverlays();
  const desired = descriptors.map(marker => marker.lazy ? marker.materialize() : marker);
  const wanted = new Set(desired), old = new Set(previous);
  const removed = previous.filter((marker: any) => !wanted.has(marker));
  if (removed.length) group.removeOverlays(removed);
  for (const marker of removed) marker.__lazyOwner?.release();
  const added = desired.filter(marker => !old.has(marker));
  if (added.length) group.addOverlays(added);
}

export function clearStopMarkerGroup(group: any) {
  if (!group) return;
  const previous = group.getOverlays();
  group.clearOverlays();
  for (const marker of previous) marker.__lazyOwner?.release();
}
