import { loadSharedCity } from './sharedCityClient';
import { CityDataCache } from './cityDataCache';

// Full snapshots are reserved for explicit features that need complete routes or city metadata.
export const cityDataCache = new CityDataCache(loadSharedCity);
