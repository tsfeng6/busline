import type { CityDataset } from './cityDataset';
import {
  createCityContestQuestion, createLocalContestQuestion, createNetworkContestQuestion, estimateUrbanDistrict, hasContestDistricts, contestDistrictPolygons,
} from './contestQuestions';
import type { ContestRules } from './contestRules';
import type { PublishedCity } from './localTransit';
import { shuffle, type GameMode, type OfflineQuestion } from './offlineGame';

export function rankedQuestionRandom(run: string, number: number) {
  let state = 2166136261;
  for (const char of `${run}:${number}`) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createSimulationQuestion(
  mode: GameMode, city: string, province: string, rules: ContestRules, previous: string,
  catalog: PublishedCity[], loadCity: (city: string) => Promise<CityDataset>, signal: AbortSignal, random = Math.random,
  loadCityImage?: (item: PublishedCity) => Promise<string>,
): Promise<OfflineQuestion> {
  const catalogRevision = () => rankedQuestionRandom(
    JSON.stringify(catalog.map(item => [item.city, item.capturedAt, item.countySeats.map(seat => seat.name)])), 0,
  )().toString(36);
  if (mode === 'county') {
    const seats = catalog.filter(item => item.province === province).flatMap(item => item.countySeats);
    const available = seats.filter(seat => seat.name !== previous);
    const names = seats.map(seat => seat.name);
    for (const seat of shuffle(available.length ? available : seats, random)) {
      signal.throwIfAborted();
      try {
        const data = await loadCity(seat.city);
        signal.throwIfAborted();
        return { ...createNetworkContestQuestion(mode, data, rules, names, previous, seat, random),
          sourceRevision: catalogRevision() + ':' + data.capturedAt };
      } catch {
        signal.throwIfAborted();
        // Try another published county seat in this province.
      }
    }
    throw Error('该省份暂无符合当前标签的县城题目。');
  }

  if (mode === 'city') {
    const available = catalog.filter(item => item.city !== previous);
    const picked = shuffle(available.length ? available : catalog, random)[0];
    if (!picked) throw Error('网站暂时没有可供出题的城市线路数据。');
    if (loadCityImage) {
      const question = createCityContestQuestion(picked.city, rules, catalog.map(item => item.city), random);
      const networkImage = await loadCityImage(picked);
      signal.throwIfAborted();
      return { ...question, networkImage, sourceRevision: catalogRevision() };
    }
    const data = await loadCity(picked.city);
    signal.throwIfAborted();
    return createNetworkContestQuestion(mode, data, rules, catalog.map(item => item.city), previous, undefined, random);
  }

  if (!catalog.some(item => item.city === city)) throw Error('请选择网站已有线路图的城市。');
  const data = await loadCity(city);
  signal.throwIfAborted();
  const polygons = hasContestDistricts(city)
    ? contestDistrictPolygons(city)
    : estimateUrbanDistrict(data);
  signal.throwIfAborted();
  return { ...createLocalContestQuestion(mode, data, rules, polygons, previous, random), sourceRevision: data.capturedAt + ':bus-scope-v7' };
}
