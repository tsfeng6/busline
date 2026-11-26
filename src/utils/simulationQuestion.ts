import type { CityDataset } from './cityDataset';
import {
  createLocalContestQuestion, createNetworkContestQuestion, estimateUrbanDistrict, hasContestDistricts, contestDistrictPolygons,
} from './contestQuestions';
import type { ContestRules } from './contestRules';
import type { PublishedCity } from './localTransit';
import { shuffle, type GameMode, type OfflineQuestion } from './offlineGame';

export async function createSimulationQuestion(
  mode: GameMode, city: string, province: string, rules: ContestRules, previous: string,
  catalog: PublishedCity[], loadCity: (city: string) => Promise<CityDataset>, signal: AbortSignal,
): Promise<OfflineQuestion> {
  if (mode === 'county') {
    const seats = catalog.filter(item => item.province === province).flatMap(item => item.countySeats);
    const available = seats.filter(seat => seat.name !== previous);
    const names = seats.map(seat => seat.name);
    for (const seat of shuffle(available.length ? available : seats)) {
      signal.throwIfAborted();
      try {
        const data = await loadCity(seat.city);
        signal.throwIfAborted();
        return createNetworkContestQuestion(mode, data, rules, names, previous, seat);
      } catch {
        signal.throwIfAborted();
        // Try another published county seat in this province.
      }
    }
    throw Error('该省份暂无符合当前标签的县城题目。');
  }

  if (mode === 'city') {
    const available = catalog.filter(item => item.city !== previous);
    const picked = shuffle(available.length ? available : catalog)[0];
    if (!picked) throw Error('网站暂时没有可供出题的城市线路数据。');
    const data = await loadCity(picked.city);
    signal.throwIfAborted();
    return createNetworkContestQuestion(mode, data, rules, catalog.map(item => item.city), previous);
  }

  if (!catalog.some(item => item.city === city)) throw Error('请选择网站已有线路图的城市。');
  const data = await loadCity(city);
  signal.throwIfAborted();
  const citywide = rules.range === 'all-city' || rules.range === 'unusual';
  const polygons = citywide ? [] : hasContestDistricts(city)
    ? contestDistrictPolygons(city)
    : estimateUrbanDistrict(data);
  signal.throwIfAborted();
  return createLocalContestQuestion(mode, data, rules, polygons, previous);
}
