import { brotliDecompressSync } from 'node:zlib';
import { createHash, randomInt } from 'node:crypto';
import { CITY_BVPK_BLOCK_LIMIT, cityBvpkPartPath, readCityBvpkPart, resolveCityStorage } from '../../src/utils/cityBvpk';
import { cityDataKey, normalizeCityDataset } from '../../src/utils/cityDataset';
import { normalizeQuizCatalog, validCityOverview } from '../../src/utils/cityOverview';
import type { PublishedCity } from '../../src/utils/localTransit';
import { shuffle, type GameMode, type OfflineQuestion } from '../../src/utils/offlineGame';
import { createCityContestQuestion, createLocalContestQuestion, createNetworkContestQuestion, contestDistrictPolygons } from '../../src/utils/contestQuestions';
import { createSimulationQuestion, rankedQuestionRandom } from '../../src/utils/simulationQuestion';
import type { ContestRules } from '../../src/utils/contestRules';

export async function createRankedQuestion(
  appOrigin: string, fetcher: typeof fetch, mode: GameMode,
  scope: string, previous: string, rules: ContestRules, useCityThumbnail = false,
  local?: { run: string; number: number },
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
  const loadCity = async (city: string) => {
    const folder = `${encodeURIComponent(cityDataKey(city))}/`;
    const manifest = await (await read(folder + 'latest.json')).json();
    return normalizeCityDataset(await resolveCityStorage(manifest,
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
  };
  if (local) {
    const catalog = normalizeQuizCatalog(index.cities);
    // The browser draws the question. For the city mode only its selection is needed for verification.
    return createSimulationQuestion(mode, scope, scope, rules, previous, catalog, loadCity,
      AbortSignal.timeout(32000), rankedQuestionRandom(local.run, local.number), async () => '');
  }
  const catalog = index.cities.filter(validCityOverview) as (PublishedCity & { thumbnail: string })[];
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
      if (mode === 'city' && useCityThumbnail) {
        const thumbnail = catalog.find(city => city.city === candidate.city)?.thumbnail;
        if (!thumbnail?.endsWith('.png')) continue;
        const response = await read(thumbnail);
        const png = Buffer.from(await response.arrayBuffer());
        if (png.length > 2 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) continue;
        return { ...createCityContestQuestion(candidate.city, rules, catalog.map(city => city.city), random),
          networkImage: png.toString('base64') };
      }
      const data = await loadCity(candidate.city);
      if (mode === 'line' || mode === 'station') {
        const polygons = rules.range === 'all-city' || rules.range === 'unusual'
          ? [] : contestDistrictPolygons(scope);
        return createLocalContestQuestion(mode, data, rules, polygons, previous, random);
      }
      return createNetworkContestQuestion(mode, data, rules,
        mode === 'county' ? seats.map(seat => seat.name) : catalog.map(city => city.city), previous, candidate.seat, random);
    } catch (error) {
      if (!(mode === 'county' || (mode === 'city' && useCityThumbnail)) || Date.now() >= deadline) throw error;
    }
  }
  throw Error('这个榜单暂无可用的已收录题目。');
}
