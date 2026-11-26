import { brotliDecompressSync } from 'node:zlib';
import { createHash, randomInt } from 'node:crypto';
import { CITY_BVPK_BLOCK_LIMIT, cityBvpkPartPath, readCityBvpkPart, resolveCityStorage } from '../../src/utils/cityBvpk';
import { cityDataKey, normalizeCityDataset } from '../../src/utils/cityDataset';
import { validCityOverview } from '../../src/utils/cityOverview';
import { routeName, type Point, type PublishedCity } from '../../src/utils/localTransit';
import { createOfflineQuestion, shuffle, type GameDifficulty, type GameMode, type OfflineQuestion } from '../../src/utils/offlineGame';
import { createLocalContestQuestion, loadContestDistricts } from './contestQuestions';
import type { ContestRules } from '../../src/utils/contestRules';
import type { RankedPuzzle } from '../../src/utils/rankedGame';

export async function createRankedQuestion(
  appOrigin: string, fetcher: typeof fetch, mode: GameMode, difficulty: GameDifficulty,
  scope: string, number: number, previous: string, rules: ContestRules,
): Promise<OfflineQuestion> {
  const app = new URL(appOrigin);
  const deadline = Date.now() + 32000;
  const basePath = app.pathname.replace(/\/$/, '') + '/city-data/v1/';
  const read = async (path: string) => {
    const url = new URL(basePath + path, app.origin);
    if (url.origin !== app.origin || !url.pathname.startsWith(basePath)) throw Error('题库路径无效。');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error('题库读取超时。');
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(Math.min(10000, remaining)) });
    if (!response.ok) throw Error('已收录题库暂时无法读取。');
    return response;
  };
  const index = await (await read('overview.json')).json();
  if (!Array.isArray(index.cities)) throw Error('题库目录无效。');
  const catalog = index.cities.filter(validCityOverview) as PublishedCity[];
  const random = () => randomInt(0, 2 ** 32) / 2 ** 32;
  const seats = mode === 'county' ? catalog.filter(item => item.province === scope).flatMap(item => item.countySeats ?? []) : [];
  const cities = mode === 'city' ? catalog : catalog.filter(item => item.city === scope);
  const pool = mode === 'county' ? seats.map(seat => ({ city: seat.city, answer: seat.name, seat }))
    : cities.map(item => ({ city: item.city, answer: item.city, seat: undefined }));
  const remaining = pool.filter(item => pool.length === 1 || item.answer !== previous);
  // City choices include cities from the same public catalogue. Fetches for
  // the chosen snapshot stay in the gateway, away from the player's browser.
  for (const candidate of shuffle(remaining.length ? remaining : pool, random)) {
    try {
      const folder = `${encodeURIComponent(cityDataKey(candidate.city))}/`;
      const manifest = await (await read(folder + 'latest.json')).json();
      const data = normalizeCityDataset(await resolveCityStorage(manifest,
        async part => (await read(folder + part)).json(),
        descriptor => readCityBvpkPart(descriptor, async () => {
          const response = await read(folder + cityBvpkPartPath(descriptor));
          if (!response.body) throw Error('题库分片为空。');
          const buffer = new Uint8Array(descriptor.bytes);
          const reader = response.body.getReader();
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (size + value.length > buffer.length) throw Error('题库分片长度无效。');
              buffer.set(value, size);
              size += value.length;
            }
          } finally { await reader.cancel(); }
          return buffer.subarray(0, size);
        }, async bytes => brotliDecompressSync(bytes, { maxOutputLength: CITY_BVPK_BLOCK_LIMIT }),
        async bytes => createHash('sha256').update(bytes).digest('hex')), { partConcurrency: 3 }));
      if (mode === 'line' || mode === 'station') {
        const polygons = rules.range === 'all-city' ? [] : await loadContestDistricts(scope, fetcher);
        return createLocalContestQuestion(mode, data, rules, polygons, previous, random);
      }
      const question = createOfflineQuestion(mode, difficulty, data,
        mode === 'county' ? seats.map(seat => seat.name) : catalog.map(city => city.city),
        number, previous, candidate.seat, random);
      if (!rules.fill && question.options.length < 2) throw Error('题库暂无足够的选择题选项。');
      return { ...question, isFillIn: rules.fill, options: rules.fill ? [] : question.options };
    } catch (error) {
      if (mode !== 'county' || Date.now() >= deadline) throw error;
    }
  }
  throw Error('这个榜单暂无可用的已收录题目。');
}

export function rankedDrawing(question: OfflineQuestion, mode: GameMode, cycle = false): RankedPuzzle['drawing'] {
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
  const anchor = question.countyWindow?.center ?? paths.find(path => path.length)?.[0] ?? [0, 0];
  const longitudeScale = Math.cos(anchor[1] * Math.PI / 180);
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const path of paths) for (const [lng, lat] of path) {
    const x = (lng - anchor[0]) * longitudeScale, y = lat - anchor[1];
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  if (question.countyWindow) {
    const delta = question.countyWindow.radius / 111320;
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
      if (previous && pixel.some((value, i) => value !== previous![i])
        && pixel.every(value => value >= 0 && value <= 1000)
        && previous.every(value => value >= 0 && value <= 1000)) {
        const [a, b] = [previous.join(' '), pixel.join(' ')].sort();
        roads.add('M' + a + 'L' + b);
        if (roads.size >= 12000) break;
      }
      previous = pixel;
    }
    if (roads.size >= 12000) break;
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
  const local = mode === 'line' || mode === 'station';
  return {
    path: cycle ? '' : routePaths.join(''), frames: cycle ? [...frames.values()] : undefined, arrows, basemap: [...roads].join(''), county: !!question.countyWindow,
    stops: local && question.showStops && !cycle ? (question.networkStops ?? []).map(stop => project(stop.lngLat)) : [],
    target: question.targetPoint ? project(question.targetPoint.lngLat) : undefined,
    terminals: mode === 'line' ? paths.filter(points => points.length > 1).map(points => ({ first: project(points[0]), last: project(points.at(-1)!) })) : [],
  };
}
