import type { Point } from './localTransit';
import type { OfflineQuestion } from './offlineGame';
import { contestRouteColors } from './contestRouteColors';

type MapQuestion = Pick<OfflineQuestion, 'lineInfos' | 'targetPoint'> & { networkStops?: { lngLat: Point }[] };

export function mountContestMap(
  map: any, AMap: any, question: MapQuestion, mode: 'line' | 'station' | 'accessibility',
  showStops: boolean, panel: HTMLElement | null,
) {
  const routes: any[] = [];
  const overlayList: any[] = [];
  const marker = (center: Point, fillColor: string, radius: number) => new AMap.CircleMarker({
    center, radius, fillColor, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, zIndex: 65,
  });

  const lines = question.lineInfos ?? [];
  const colors = mode === 'accessibility' ? contestRouteColors(lines) : [];
  for (const [index, line] of lines.entries()) {
    if (!line.path || line.path.length < 2) continue;
    let path = line.path;
    const firstStop = line.via_stops?.[0]?.location;
    if (mode === 'line' && firstStop) {
      const distance = ([lng, lat]: Point) => Math.hypot(lng - firstStop.lng, lat - firstStop.lat);
      if (distance(path[0]) > distance(path.at(-1)!)) path = [...path].reverse();
    }
    const route = new AMap.Polyline({
      path, strokeColor: colors[index] ?? '#346DB3', strokeWeight: 5, strokeOpacity: 1, showDir: mode === 'line',
      lineJoin: 'round', lineCap: 'round', isOutline: true, outlineColor: '#fff', borderWeight: 1, zIndex: 55,
    });
    routes.push(route);
    overlayList.push(route);
    if (mode === 'line') {
      overlayList.push(marker(path[0], '#16a34a', 6), marker(path.at(-1)!, '#ef4444', 5));
    }
  }

  if (!routes.length && !question.targetPoint) return;
  if (showStops) for (const stop of question.networkStops ?? []) {
    overlayList.push(marker(stop.lngLat, '#346DB3', 4));
  }
  if (question.targetPoint) {
    const target = marker(question.targetPoint.lngLat, '#ef4444', 8);
    target.setOptions({ zIndex: 85 });
    overlayList.push(target);
  }

  let fitObserver: ResizeObserver | undefined;
  const cleanup = () => {
    fitObserver?.disconnect();
    map.remove(overlayList);
  };
  try {
    map.add(overlayList);
    const fit = () => {
      if (!routes.length && question.targetPoint) {
        map.setZoomAndCenter(15, question.targetPoint.lngLat);
        return;
      }
      const bottom = Math.min(map.getSize().height * .65, (panel?.offsetHeight ?? 160) + 24);
      map.setFitView(routes, false, [32, 32, bottom, 32]);
    };
    fit();
    if (panel && typeof ResizeObserver !== 'undefined') {
      fitObserver = new ResizeObserver(fit);
      fitObserver.observe(panel);
    }
    return cleanup;
  } catch {
    cleanup();
  }
}
