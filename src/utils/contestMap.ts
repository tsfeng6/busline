import { routeName, type Point } from './localTransit';
import type { OfflineQuestion } from './offlineGame';

type MapQuestion = Pick<OfflineQuestion, 'lineInfos' | 'targetPoint'> & { networkStops?: { lngLat: Point }[] };

export function mountContestMap(
  map: any, AMap: any, question: MapQuestion, mode: 'line' | 'station',
  showStops: boolean, cycle: boolean, panel: HTMLElement | null,
) {
  const frames = new Map<string, any[]>();
  const routes: any[] = [];
  const overlayList: any[] = [];
  const marker = (center: Point, fillColor: string, radius: number) => new AMap.CircleMarker({
    center, radius, fillColor, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, zIndex: 65,
  });

  for (const line of question.lineInfos ?? []) {
    if (!line.path || line.path.length < 2) continue;
    let path = line.path;
    const firstStop = line.via_stops?.[0]?.location;
    if (mode === 'line' && firstStop) {
      const distance = ([lng, lat]: Point) => Math.hypot(lng - firstStop.lng, lat - firstStop.lat);
      if (distance(path[0]) > distance(path.at(-1)!)) path = [...path].reverse();
    }
    const route = new AMap.Polyline({
      path, strokeColor: '#346DB3', strokeWeight: 5, strokeOpacity: 1, showDir: mode === 'line',
      lineJoin: 'round', lineCap: 'round', isOutline: true, outlineColor: '#fff', borderWeight: 1, zIndex: 55,
    });
    routes.push(route);
    overlayList.push(route);
    if (mode === 'line') {
      overlayList.push(marker(path[0], '#16a34a', 6), marker(path.at(-1)!, '#ef4444', 5));
    }
    if (cycle) {
      const name = routeName(line.name);
      const frame = frames.get(name) ?? [];
      frame.push(route);
      if (showStops) for (const { location } of line.via_stops ?? []) {
        if (Number.isFinite(location?.lng) && Number.isFinite(location?.lat)) {
          const stop = marker([location.lng, location.lat], '#346DB3', 4);
          frame.push(stop);
          overlayList.push(stop);
        }
      }
      frames.set(name, frame);
    }
  }

  if (!routes.length) return;
  if (showStops && !cycle) for (const stop of question.networkStops ?? []) {
    overlayList.push(marker(stop.lngLat, '#346DB3', 4));
  }
  if (question.targetPoint) {
    const target = marker(question.targetPoint.lngLat, '#ef4444', 8);
    target.setOptions({ zIndex: 85 });
    overlayList.push(target);
  }

  const routeFrames = [...frames.values()];
  let active = 0;
  let fitObserver: ResizeObserver | undefined;
  let timer: number | undefined;
  const cleanup = () => {
    fitObserver?.disconnect();
    if (timer !== undefined) window.clearInterval(timer);
    map.remove(overlayList);
  };
  try {
    map.add(overlayList);
    const fit = () => {
      const bottom = Math.min(map.getSize().height * .65, (panel?.offsetHeight ?? 160) + 24);
      // Fit all directions even when the station's visible directions rotate.
      routeFrames.forEach(frame => frame.forEach(overlay => overlay.show()));
      map.setFitView(routes, false, [32, 32, bottom, 32]);
      routeFrames.forEach((frame, index) => {
        if (index !== active) frame.forEach(overlay => overlay.hide());
      });
    };
    fit();
    if (panel && typeof ResizeObserver !== 'undefined') {
      fitObserver = new ResizeObserver(fit);
      fitObserver.observe(panel);
    }
    if (routeFrames.length > 1) {
      timer = window.setInterval(() => {
        routeFrames[active].forEach(overlay => overlay.hide());
        active = (active + 1) % routeFrames.length;
        routeFrames[active].forEach(overlay => overlay.show());
      }, 1000);
    }
    return cleanup;
  } catch {
    cleanup();
  }
}
