import { cityDataKey } from './cityDataset';
import { resolveCityParts } from './cityStorage';

/** Reading is independent of upload credentials, gateway URLs and their availability. */
export function sharedCityStaticURL(city: string, suffix = '', version = '', base = '/') {
  if (suffix && suffix !== 'history' && !/^history\/[\dTZ-]+-[a-f0-9]{12}$/.test(suffix)) throw Error('快照版本无效。');
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base)) throw Error('共享数据必须使用网站同源路径。');
  const root = base.replace(/\/$/, '');
  const path = `${root}/city-data/v1/${encodeURIComponent(cityDataKey(city))}/${suffix ? suffix + '.json' : 'latest.json'}`;
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

export async function readCityJSON(url: string, transport: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
  // Reject external fallbacks even if a legacy deployment still defines their environment variables.
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) throw Error('共享数据必须使用网站同源路径。');
  const read = async (path: string, immutable = false) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await transport(path, { signal: AbortSignal.timeout(60000), cache: immutable ? 'force-cache' : 'no-cache' });
        if (!response.ok) throw Object.assign(Error(response.status === 404 ? '该城市暂无已发布的快照，或数据仍在发布中。' : '共享线路文件暂时无法读取。'), { status: response.status });
        // Vite may serve index.html for a missing JSON file; this is not usable city data.
        return await response.json();
      } catch (error: any) {
        if (error.status === 404) throw error;
        if (attempt === 0) continue;
        throw Object.assign(Error('共享线路读取失败，请稍后重试；本地检索仍可使用。'), { status: error.status || 503 });
      }
    }
  };
  const result = await read(url);
  const base = url.replace(/[?#].*$/, '').replace(/(?:\/history\/[^/]+|\/latest\.json)$/, '').replace(/\/?$/, '/');
  return resolveCityParts(result, part => read(base + part, true));
}
