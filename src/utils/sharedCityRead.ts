import { cityDataKey } from './cityDataset';
import { CITY_BVPK_BLOCK_LIMIT, cityBvpkManifest, cityBvpkPartPath, readCityBvpkPart, resolveCityStorage, type BrotliDecode } from './cityBvpk';
import { decodeBrowserBrotli } from './browserBrotli';

/** Reading is independent of upload credentials, gateway URLs and their availability. */
export function sharedCityStaticURL(city: string, suffix = '', version = '', base = '/') {
  if (suffix && suffix !== 'history' && !/^history\/[\dTZ-]+-[a-f0-9]{12}$/.test(suffix)) throw Error('快照版本无效。');
  if ((base !== './' && base !== '' && !base.startsWith('/')) || base.startsWith('//') || /[?#\\]/.test(base)) throw Error('共享数据必须使用网站同源路径。');
  const root = base === './' || base === '' ? '.' : base.replace(/\/$/, '');
  const path = `${root}/city-data/v1/${encodeURIComponent(cityDataKey(city))}/${suffix ? suffix + '.json' : 'latest.json'}`;
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

export async function readCityJSON(
  url: string,
  transport: typeof fetch = (input, init) => globalThis.fetch(input, init),
  { decompress = decodeBrowserBrotli, expectedSnapshotId }: { decompress?: BrotliDecode; expectedSnapshotId?: string } = {},
) {
  if ((!url.startsWith('/') && !url.startsWith('./')) || url.startsWith('//') || url.includes('\\')) throw Error('共享数据必须使用网站同源路径。');
  const request = async <T>(path: string, parse: (response: Response) => Promise<T>, immutable = false) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const cache = immutable ? (attempt ? 'reload' : 'force-cache') : 'no-cache';
        const response = await transport(path, { signal: AbortSignal.timeout(60000), cache, redirect: 'error' });
        if (!response.ok) throw Object.assign(Error('共享线路文件暂时无法读取。'), { status: response.status });
        return await parse(response);
      } catch (error: any) {
        if (path === url && error.status === 404) throw error;
        if (attempt === 0) continue;
        throw Object.assign(Error('共享线路读取失败，请稍后重试；本地检索仍可使用。'), { status: 503, cause: error });
      }
    }
  };
  const json = (path: string, immutable = false) => request(path, response => response.json(), immutable);
  const result = await json(url);
  if (expectedSnapshotId && cityBvpkManifest(result)?.snapshotId !== expectedSnapshotId) {
    throw Object.assign(Error('共享线路仍在同步。'), { status: 503 });
  }
  const base = url.replace(/[?#].*$/, '').replace(/(?:\/history\/[^/]+|\/latest\.json)$/, '').replace(/\/?$/, '/');
  return resolveCityStorage(result, part => json(base + part, true), descriptor =>
    request(base + cityBvpkPartPath(descriptor), response =>
      readCityBvpkPart(descriptor, async () => {
        if (Number(response.headers.get('Content-Length')) > CITY_BVPK_BLOCK_LIMIT || !response.body) throw Error('BVPK1: 分片响应无效。');
        const bytes = new Uint8Array(descriptor.bytes);
        const reader = response.body.getReader();
        let offset = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (offset + value.byteLength > bytes.length) throw Error('BVPK1: 分片长度无效。');
            bytes.set(value, offset);
            offset += value.byteLength;
          }
        } finally { await reader.cancel(); }
        return bytes.subarray(0, offset);
      }, decompress, async bytes => {
        const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      }), true),
  );
}
