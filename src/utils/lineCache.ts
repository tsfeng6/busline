import { formatOperatingTime } from './operatingHours';
import { BusLine } from '../types';

export const APP_LINE_CACHE_ENABLED_KEY = 'app_line_cache_enabled';
export const APP_LINE_CACHE_MONTH_KEY = 'app_line_cache_month';

export interface GeoBox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

export interface CachedStopPoi {
  id?: string;
  name: string;
  address: string;
  location: { lng: number; lat: number };
}

export interface CachedSearchRegion {
  id: string;
  city: string;
  isCityWide: boolean;
  isComplete: boolean;
  discoveryVersion?: number;
  searchBounds: GeoBox;
  timestamp: number;
}

export interface LineCacheStats {
  linesCount: number;
  stopsCount: number;
  regionsCount: number;
}

const DB_NAME = 'busline_persistent_cache_v1';
const DB_VERSION = 1;
const STORE_STOPS = 'stops';
const STORE_LINES = 'lines';
const STORE_QUERIED = 'queriedNames';
const STORE_REGIONS = 'regions';

export const getCurrentMonthKey = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const openCacheDB = (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_STOPS)) {
          const store = db.createObjectStore(STORE_STOPS, { keyPath: 'key' });
          store.createIndex('city', 'city', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_LINES)) {
          const store = db.createObjectStore(STORE_LINES, { keyPath: 'key' });
          store.createIndex('city', 'city', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_QUERIED)) {
          const store = db.createObjectStore(STORE_QUERIED, { keyPath: 'key' });
          store.createIndex('city', 'city', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_REGIONS)) {
          const store = db.createObjectStore(STORE_REGIONS, { keyPath: 'id' });
          store.createIndex('city', 'city', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

export const clearAllLineCache = async (): Promise<void> => {
  const db = await openCacheDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE_STOPS, STORE_LINES, STORE_QUERIED, STORE_REGIONS], 'readwrite');
      tx.objectStore(STORE_STOPS).clear();
      tx.objectStore(STORE_LINES).clear();
      tx.objectStore(STORE_QUERIED).clear();
      tx.objectStore(STORE_REGIONS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

export const checkAndPurgeIfMonthChanged = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  const currMonth = getCurrentMonthKey();
  const savedMonth = localStorage.getItem(APP_LINE_CACHE_MONTH_KEY);
  if (savedMonth && savedMonth !== currMonth) {
    await clearAllLineCache();
    localStorage.setItem(APP_LINE_CACHE_MONTH_KEY, currMonth);
    return true;
  }
  if (!savedMonth) {
    localStorage.setItem(APP_LINE_CACHE_MONTH_KEY, currMonth);
  }
  return false;
};

export const getLineCacheStats = async (): Promise<LineCacheStats> => {
  const db = await openCacheDB();
  if (!db) return { linesCount: 0, stopsCount: 0, regionsCount: 0 };

  const countStore = (store: IDBObjectStore): Promise<number> =>
    new Promise((resolve) => {
      try {
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });

  try {
    const tx = db.transaction([STORE_LINES, STORE_STOPS, STORE_REGIONS], 'readonly');
    const [linesCount, stopsCount, regionsCount] = await Promise.all([
      countStore(tx.objectStore(STORE_LINES)),
      countStore(tx.objectStore(STORE_STOPS)),
      countStore(tx.objectStore(STORE_REGIONS)),
    ]);
    return { linesCount, stopsCount, regionsCount };
  } catch {
    return { linesCount: 0, stopsCount: 0, regionsCount: 0 };
  }
};

const readByCity = <T,>(db: IDBDatabase, storeName: string, city: string): Promise<T[]> =>
  new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index('city');
      const req = index.getAll(city);
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

export const getCityCacheData = async (
  city: string
): Promise<{
  purged: boolean;
  regions: CachedSearchRegion[];
  stops: CachedStopPoi[];
  lines: BusLine[];
  queriedNames: string[];
}> => {
  const purged = await checkAndPurgeIfMonthChanged();
  if (purged) {
    return { purged: true, regions: [], stops: [], lines: [], queriedNames: [] };
  }
  const db = await openCacheDB();
  if (!db || !city) {
    return { purged: false, regions: [], stops: [], lines: [], queriedNames: [] };
  }

  const [regionRecords, stopRecords, lineRecords, queriedRecords] = await Promise.all([
    readByCity<CachedSearchRegion>(db, STORE_REGIONS, city),
    readByCity<{ key: string; city: string; stop: CachedStopPoi }>(db, STORE_STOPS, city),
    readByCity<{ key: string; city: string; name: string; line: BusLine }>(db, STORE_LINES, city),
    readByCity<{ key: string; city: string; lineName: string }>(db, STORE_QUERIED, city),
  ]);

  return {
    purged: false,
    regions: regionRecords,
    stops: stopRecords.map((r) => r.stop),
    lines: lineRecords.map((r) => r.line),
    queriedNames: queriedRecords.map((r) => r.lineName),
  };
};

const subtractGeoBox = (target: GeoBox, cutter: GeoBox, eps = 1e-4): GeoBox[] => {
  const cMinLng = cutter.minLng - eps;
  const cMaxLng = cutter.maxLng + eps;
  const cMinLat = cutter.minLat - eps;
  const cMaxLat = cutter.maxLat + eps;

  if (
    target.maxLng <= cMinLng ||
    target.minLng >= cMaxLng ||
    target.maxLat <= cMinLat ||
    target.minLat >= cMaxLat
  ) {
    return [target];
  }

  const pieces: GeoBox[] = [];
  if (target.minLng < cMinLng) {
    pieces.push({ minLng: target.minLng, maxLng: cMinLng, minLat: target.minLat, maxLat: target.maxLat });
  }
  if (target.maxLng > cMaxLng) {
    pieces.push({ minLng: cMaxLng, maxLng: target.maxLng, minLat: target.minLat, maxLat: target.maxLat });
  }
  const ixMinLng = Math.max(target.minLng, cMinLng);
  const ixMaxLng = Math.min(target.maxLng, cMaxLng);
  if (ixMaxLng > ixMinLng) {
    if (target.minLat < cMinLat) {
      pieces.push({ minLng: ixMinLng, maxLng: ixMaxLng, minLat: target.minLat, maxLat: cMinLat });
    }
    if (target.maxLat > cMaxLat) {
      pieces.push({ minLng: ixMinLng, maxLng: ixMaxLng, minLat: cMaxLat, maxLat: target.maxLat });
    }
  }
  return pieces;
};

export const isSearchScopeCached = (
  regions: CachedSearchRegion[],
  targetBounds: GeoBox,
  isCityWide: boolean
): boolean => {
  if (!regions || regions.length === 0) return false;

  if (regions.some((r) => r.isCityWide && r.isComplete && r.discoveryVersion === 4)) {
    return true;
  }

  if (isCityWide) {
    return false;
  }

  let remaining: GeoBox[] = [targetBounds];
  for (const region of regions) {
    if ((region.isCityWide && region.discoveryVersion !== 4) || !region.isComplete) {
      continue;
    }
    remaining = remaining.flatMap((piece) => subtractGeoBox(piece, region.searchBounds));
    if (remaining.length === 0) {
      return true;
    }
  }
  return false;
};

const toPlainLngLat = (loc: any): { lng: number; lat: number } => {
  if (!loc) return { lng: 0, lat: 0 };
  if (Array.isArray(loc)) return { lng: Number(loc[0] || 0), lat: Number(loc[1] || 0) };
  const lng = typeof loc.getLng === 'function' ? loc.getLng() : Number(loc.lng || 0);
  const lat = typeof loc.getLat === 'function' ? loc.getLat() : Number(loc.lat || 0);
  return { lng, lat };
};

const serializeBusLine = (line: BusLine, city: string): BusLine => ({
  id: line.id || '',
  name: line.name,
  city: line.city || city,
  path: (line.path || []).every((p:any)=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])) ? line.path : (line.path || []).map((p: any) => {
    if (Array.isArray(p)) return [Number(p[0] || 0), Number(p[1] || 0)];
    const ll = toPlainLngLat(p);
    return [ll.lng, ll.lat];
  }),
  start_stop: line.start_stop || '',
  end_stop: line.end_stop || '',
  stops: [],
  via_stops: (line.via_stops || []).map((s: any) => ({
    id: s.id || '',
    name: s.name || '',
    location: toPlainLngLat(s.location),
  })),
  scheduleFetched: line.scheduleFetched,
  scheduleDataVersion: line.scheduleDataVersion,
  scheduleDescription: line.scheduleDescription,
  sourceQueries: Array.from(new Set(line.sourceQueries || [])),
  stime: formatOperatingTime(line.stime) || undefined,
  etime: formatOperatingTime(line.etime) || undefined,
});

export const saveCitySearchToCache = async (params: {
  city: string;
  isCityWide: boolean;
  isComplete: boolean;
  searchBounds: GeoBox;
  pois: any[];
  lines: BusLine[];
  queriedNames: string[];
}): Promise<void> => {
  const { city, isCityWide, isComplete, searchBounds, pois, lines, queriedNames } = params;
  if (!city) return;

  await checkAndPurgeIfMonthChanged();
  localStorage.setItem(APP_LINE_CACHE_MONTH_KEY, getCurrentMonthKey());

  const db = await openCacheDB();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE_STOPS, STORE_LINES, STORE_QUERIED, STORE_REGIONS], 'readwrite');
      const stopsStore = tx.objectStore(STORE_STOPS);
      const linesStore = tx.objectStore(STORE_LINES);
      const queriedStore = tx.objectStore(STORE_QUERIED);
      const regionsStore = tx.objectStore(STORE_REGIONS);

      pois.forEach((poi) => {
        if (!poi || !poi.location) return;
        const loc = toPlainLngLat(poi.location);
        if (!loc.lng && !loc.lat) return;
        const stop: CachedStopPoi = {
          id: poi.id || '',
          name: poi.name || '',
          address: poi.address || '',
          location: loc,
        };
        stopsStore.put({
          key: `${city}::${loc.lng},${loc.lat}`,
          city,
          stop,
        });
      });

      lines.forEach((line) => {
        if (!line || line.isUserSubmitted || !line.name) return;
        const plainLine = serializeBusLine(line, city);
        linesStore.put({
          key: `${city}::${plainLine.name}`,
          city,
          name: plainLine.name,
          line: plainLine,
        });
      });

      queriedNames.forEach((lineName) => {
        if (!lineName) return;
        queriedStore.put({
          key: `${city}::${lineName}`,
          city,
          lineName,
        });
      });

      const regionId = isCityWide
        ? `${city}::CITYWIDE`
        : `${city}::${searchBounds.minLng.toFixed(4)},${searchBounds.minLat.toFixed(4)},${searchBounds.maxLng.toFixed(4)},${searchBounds.maxLat.toFixed(4)}`;

      const region: CachedSearchRegion = {
        id: regionId,
        city,
        isCityWide,
        isComplete,
        discoveryVersion: 4,
        searchBounds,
        timestamp: Date.now(),
      };
      regionsStore.put(region);

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

export const saveLinesToCache = async (
  city: string,
  lines: BusLine[],
  queriedNames: string[] = []
): Promise<void> => {
  if (!city || (lines.length === 0 && queriedNames.length === 0)) return;
  await checkAndPurgeIfMonthChanged();
  localStorage.setItem(APP_LINE_CACHE_MONTH_KEY, getCurrentMonthKey());

  const db = await openCacheDB();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE_LINES, STORE_QUERIED], 'readwrite');
      const linesStore = tx.objectStore(STORE_LINES);
      const queriedStore = tx.objectStore(STORE_QUERIED);

      lines.forEach((line) => {
        if (!line || line.isUserSubmitted || !line.name) return;
        const plainLine = serializeBusLine(line, city);
        linesStore.put({
          key: `${city}::${plainLine.name}`,
          city,
          name: plainLine.name,
          line: plainLine,
        });
      });

      queriedNames.forEach((lineName) => {
        if (!lineName) return;
        queriedStore.put({
          key: `${city}::${lineName}`,
          city,
          lineName,
        });
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};
