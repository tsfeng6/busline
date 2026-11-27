import { routeName, type Point } from './localTransit';
import type { GameMode, OfflineQuestion } from './offlineGame';
import type { RankedPuzzle } from './rankedGame';
import { contestRouteColors } from './contestRouteColors';

const STATION_NETWORK_HALF_WIDTH_METERS = 3000;

function clipToQuestionFrame(a: Point, b: Point): [Point, Point] | undefined {
  const [x, y] = a;
  const dx = b[0] - x, dy = b[1] - y;
  if (!dx && !dy) return;
  const inside = (value: number) => value >= 0 && value <= 1000;
  if (inside(x) && inside(y) && inside(b[0]) && inside(b[1])) return [a, b];
  if (Math.max(x, b[0]) < 0 || Math.min(x, b[0]) > 1000 ||
      Math.max(y, b[1]) < 0 || Math.min(y, b[1]) > 1000) return;
  let start = 0, end = 1;
  if (dx) {
    const left = -x / dx, right = (1000 - x) / dx;
    start = Math.max(start, Math.min(left, right));
    end = Math.min(end, Math.max(left, right));
  }
  if (dy) {
    const top = -y / dy, bottom = (1000 - y) / dy;
    start = Math.max(start, Math.min(top, bottom));
    end = Math.min(end, Math.max(top, bottom));
  }
  if (start >= end) return;
  return [
    [Math.round(x + dx * start), Math.round(y + dy * start)],
    [Math.round(x + dx * end), Math.round(y + dy * end)],
  ];
}

export function drawContestQuestion(question: OfflineQuestion, mode: GameMode, cycle = false): RankedPuzzle['drawing'] {
  if (question.networkImage) return {
    path: '', raster: question.networkImage, stops: [], terminals: [], county: false,
  };
  const lines = question.lineInfos ?? [];
  const paths = question.networkPaths ?? lines.map(line => line.path);
  if (mode === 'line') {
    const start = lines[0]?.via_stops?.[0]?.location;
    const path = paths[0];
    if (start && path?.length > 1) {
      const distance = ([lng, lat]: Point) => Math.hypot(lng - start.lng, lat - start.lat);
      if (distance(path[0]) > distance(path.at(-1)!)) paths[0] = [...path].reverse();
    }
  }
  const anchor = question.countyWindow?.center ?? paths.find(path => path.length)?.[0] ?? question.targetPoint?.lngLat ?? [0, 0];
  const longitudeScale = Math.cos(anchor[1] * Math.PI / 180);
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const path of paths) for (const [lng, lat] of path) {
    const x = (lng - anchor[0]) * longitudeScale, y = lat - anchor[1];
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  if (question.countyWindow || mode === 'station') {
    const delta = (question.countyWindow?.radius ?? STATION_NETWORK_HALF_WIDTH_METERS) / 111320;
    west = south = -delta; east = north = delta;
  }
  const scale = 930 / Math.max(east - west, north - south, 1e-9);
  const project = ([lng, lat]: Point): [number, number] => [
    Math.round(500 + ((lng - anchor[0]) * longitudeScale - (east + west) / 2) * scale),
    Math.round(500 - (lat - anchor[1] - (north + south) / 2) * scale),
  ];
  const serialize = (points: Point[]) => {
    let last = '';
    const commands: string[] = [];
    for (const point of points) {
      const pixel = project(point).join(' ');
      if (pixel !== last) commands.push((commands.length ? 'L' : 'M') + pixel);
      last = pixel;
    }
    return commands.join('');
  };
  const routePaths = paths.map(serialize);
  const coloredRoutes = mode === 'accessibility' && !question.networkPaths
    ? contestRouteColors(lines).map((color, index) => ({ path: routePaths[index], color }))
    : undefined;
  const frames = new Map<string, { path: string; stops: [number, number][] }>();
  if (cycle) lines.forEach((line, index) => {
    const name = routeName(line.name);
    const frame = frames.get(name) ?? { path: '', stops: [] };
    frame.path += routePaths[index];
    if (question.showStops) for (const stop of line.via_stops ?? []) {
      if (Number.isFinite(stop.location?.lng) && Number.isFinite(stop.location?.lat)) {
        frame.stops.push(project([stop.location.lng, stop.location.lat]));
      }
    }
    frames.set(name, frame);
  });
  const roads = new Set<string>();
  for (const points of question.contextPaths ?? []) {
    let previous: [number, number] | undefined;
    for (const point of points) {
      const pixel = project(point);
      const visible = previous && clipToQuestionFrame(previous, pixel);
      if (visible) {
        const [a, b] = visible.map(point => point.join(' ')).sort();
        if (a !== b) roads.add('M' + a + 'L' + b);
      }
      previous = pixel;
    }
  }
  const arrows: [number, number, number][] = [];
  if (mode === 'line') for (const points of paths) {
    let distance = 55;
    for (let i = 1; i < points.length; i++) {
      const [x, y] = project(points[i - 1]), [nextX, nextY] = project(points[i]);
      const dx = nextX - x, dy = nextY - y;
      const length = Math.hypot(dx, dy);
      while (distance <= length && arrows.length < 80) {
        arrows.push([Math.round(x + dx * distance / length), Math.round(y + dy * distance / length), Math.round(Math.atan2(dy, dx) * 180 / Math.PI)]);
        distance += 110;
      }
      distance -= length;
    }
  }
  const local = mode === 'line' || mode === 'station' || mode === 'accessibility';
  return {
    path: cycle || coloredRoutes ? '' : routePaths.join(''), coloredRoutes,
    frames: cycle ? [...frames.values()] : undefined, arrows, basemap: [...roads].join(''), county: !!question.countyWindow,
    stops: local && question.showStops && !cycle ? (question.networkStops ?? []).map(stop => project(stop.lngLat)) : [],
    target: question.targetPoint ? project(question.targetPoint.lngLat) : undefined,
    terminals: mode === 'line' ? paths.filter(points => points.length > 1).map(points => ({ first: project(points[0]), last: project(points.at(-1)!) })) : [],
  };
}
