export const COCOMAP_API_PATHS = [
  '/v3/place/text', '/v3/place/around', '/v3/place/polygon',
  '/v3/bus/linename', '/v3/bus/stopname', '/v3/config/district',
  '/v3/assistant/inputtips', '/v3/geocode/regeo', '/v3/direction/walking',
] as const;
type ApiPath = typeof COCOMAP_API_PATHS[number];
export const COCOMAP_KEY_STORAGE = 'app_cocomap_api_key';
export const AMAP_PROVIDER_STORAGE = 'app_amap_api_provider';

export const isCocomapKey = (key: string) => /^sk_coco_[A-Za-z0-9_-]{1,180}$/.test(key.trim());

export function readCocomapKey(storage?: Pick<Storage, 'getItem'>) {
  try {
    if (storage?.getItem('app_use_custom_api_key') !== 'true' || storage.getItem(AMAP_PROVIDER_STORAGE) !== 'cocomap') return '';
    const key = (storage.getItem(COCOMAP_KEY_STORAGE) ?? '').trim();
    return isCocomapKey(key) ? key : '';
  } catch {
    return '';
  }
}

type Point = [number, number];
type Params = Record<string, string | number | boolean | undefined>;
type Callback = (status: string, result: any) => void;
type SearchOptions = {
  city?: string; citylimit?: boolean; pageIndex?: number; pageSize?: number;
  type?: string; extensions?: string; subdistrict?: number;
};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
function point(value: any): Point | undefined {
  const parts = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [value?.lng, value?.lat];
  if (parts.length !== 2 || parts.some(v => v == null || String(v).trim() === '')) return;
  const lng = Number(parts[0]), lat = Number(parts[1]);
  if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) return [lng, lat];
}
function pathPoints(value: unknown): Point[] {
  return typeof value === 'string' ? value.split(';').flatMap(value => {
    const coordinates = point(value);
    return coordinates ? [coordinates] : [];
  }) : [];
}
function located(items: unknown) {
  return array(items).flatMap(item => {
    const coordinates = point(item?.location);
    return coordinates && typeof item.name === 'string'
      ? [{ ...item, location: { lng: coordinates[0], lat: coordinates[1] } }] : [];
  });
}
function district(item: any): any {
  return {
    ...item, districtList: array(item.districts).map(district),
    boundaries: typeof item.polyline === 'string' ? item.polyline.split('|').map(pathPoints) : [],
  };
}

export function createCocomapSearchServices(gateway: string, key: string, fetcher: typeof fetch = fetch) {
  function request(path: ApiPath, params: Params, convert: (data: any) => object | undefined, callback: Callback) {
    const url = gateway.replace(/\/$/, '') + '/amap/cocomap';
    const query = Object.fromEntries(Object.entries(params).filter(([, value]) => value != null && value !== '')
      .map(([name, value]) => [name, String(value)]));
    void (async () => {
      if (!gateway) return { status: 'error', result: { info: 'COCOMAP_UNAVAILABLE' } };
      try {
        const response = await fetcher(url, {
          method: 'POST', credentials: 'omit', redirect: 'error',
          headers: { Authorization: 'Bearer ' + key.trim(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, params: query }), signal: AbortSignal.timeout(8000),
        });
        const data = await response.json();
        if (!response.ok) return { status: 'error', result: { info: data?.info || 'COCOMAP_UNAVAILABLE' } };
        if (String(data?.status) !== '1') {
          return { status: 'error', result: { info: data?.info, infocode: data?.infocode } };
        }
        const result = convert(data);
        return { status: result ? 'complete' : 'no_data', result: result ? { info: 'OK', ...result } : { info: 'NO_DATA' } };
      } catch {
        return { status: 'error', result: { info: 'COCOMAP_UNAVAILABLE' } };
      }
    })().then(({ status, result }) => callback(status, result));
  }

  class PagedSearch {
    constructor(protected options: SearchOptions = {}) { this.options = { ...options }; }
    setPageIndex(pageIndex: number) { this.options.pageIndex = pageIndex; }
    protected get params() {
      return {
        city: this.options.city === '全国' ? undefined : this.options.city,
        page: this.options.pageIndex ?? 1, offset: Math.min(25, this.options.pageSize ?? 20),
        extensions: this.options.extensions,
      };
    }
  }

  const pois = (data: any) => {
    const items = located(data.pois).map(poi => ({
      ...poi, address: typeof poi.address === 'string' ? poi.address : '', type: typeof poi.type === 'string' ? poi.type : '',
    }));
    return items.length ? { poiList: { pois: items, count: Number(data.count) || items.length } } : undefined;
  };

  class PlaceSearch extends PagedSearch {
    private get types() { return this.options.type === '公交车站' ? '150700' : this.options.type; }
    search(value: string, callback: Callback) {
      request('/v3/place/text', { ...this.params, keywords: value, types: this.types, citylimit: this.options.citylimit }, pois, callback);
    }
    searchNearBy(value: string, location: unknown, radius: number, callback: Callback) {
      const { city, ...params } = this.params;
      request('/v3/place/around', { ...params, keywords: value, location: point(location)?.join(','), radius, types: this.types }, pois, callback);
    }
    searchInBounds(value: string, bounds: any, callback: Callback) {
      const [sw, ne] = Array.isArray(bounds) ? bounds : [bounds.getSouthWest(), bounds.getNorthEast()];
      const { city, ...params } = this.params;
      const southwest = point(sw), northeast = point(ne);
      if (!southwest || !northeast) { callback('error', { info: 'COCOMAP_INVALID_REQUEST' }); return; }
      const polygon = `${southwest[0]},${northeast[1]}|${northeast[0]},${southwest[1]}`;
      request('/v3/place/polygon', { ...params, keywords: value, polygon, types: this.types }, pois, callback);
    }
  }

  class LineSearch extends PagedSearch {
    search(keywords: string, callback: Callback) {
      request('/v3/bus/linename', { ...this.params, keywords, extensions: 'all' }, data => {
        const lineInfo = array(data.buslines).flatMap(line => {
          const path = pathPoints(line.polyline);
          return typeof line.name === 'string' && path.length >= 2
            ? [{ ...line, path, via_stops: located(line.busstops) }] : [];
        });
        return lineInfo.length ? { lineInfo, count: Number(data.count) || lineInfo.length } : undefined;
      }, callback);
    }
  }

  class StationSearch extends PagedSearch {
    search(keywords: string, callback: Callback) {
      request('/v3/bus/stopname', { ...this.params, keywords, extensions: 'all' }, data => {
        const stationInfo = located(data.busstops);
        return stationInfo.length ? { stationInfo } : undefined;
      }, callback);
    }
  }

  class DistrictSearch {
    constructor(private options: SearchOptions = {}) {}
    search(keywords: string, callback: Callback) {
      request('/v3/config/district', { keywords, subdistrict: this.options.subdistrict, extensions: this.options.extensions },
        data => array(data.districts).length ? { districtList: data.districts.map(district) } : undefined, callback);
    }
  }

  class AutoComplete {
    constructor(private options: SearchOptions = {}) {}
    search(keywords: string, callback: Callback) {
      request('/v3/assistant/inputtips', { keywords, city: this.options.city, citylimit: this.options.citylimit }, data => {
        const tips = array(data.tips).map(tip => {
          const coordinates = point(tip.location);
          return { ...tip, location: coordinates ? { lng: coordinates[0], lat: coordinates[1] } : undefined };
        });
        return tips.length ? { tips } : undefined;
      }, callback);
    }
  }

  class Geocoder {
    constructor(private options: SearchOptions = {}) {}
    getAddress(location: unknown, callback: Callback) {
      request('/v3/geocode/regeo', { location: point(location)?.join(','), extensions: this.options.extensions },
        data => data.regeocode ? {
          regeocode: { ...data.regeocode, formattedAddress: data.regeocode.formatted_address },
        } : undefined, callback);
    }
  }

  class Walking {
    search(origin: Point, destination: Point, callback: Callback) {
      request('/v3/direction/walking', { origin: origin.join(','), destination: destination.join(',') }, data => {
        const routes = array(data.route?.paths).map(route => ({
          distance: route.distance, time: route.duration,
          steps: array(route.steps).map(step => ({ ...step, path: pathPoints(step.polyline) })),
        }));
        return routes.length ? { routes } : undefined;
      }, callback);
    }
  }
  return { PlaceSearch, LineSearch, StationSearch, DistrictSearch, AutoComplete, Geocoder, Walking };
}
