import { cityStorageFiles, cityContentHash, cityContentBytes } from '../../scripts/city-storage-files';
import { isCityParts, validateCityPart, resolveCityParts } from '../utils/cityStorage';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cityDataKey, cityDatasetExpiresAt, normalizeCityDataset, usableCityDataset, type CityDataset, type CitySnapshotMeta } from '../utils/cityDataset';

type Config = { repo: string; branch: string; token: string; enabled: boolean };
type Transport = typeof fetch;
const config = (): Config => ({ repo: process.env.CITY_DATA_GITHUB_REPO || 'tsfeng6/busline',
  branch: process.env.CITY_DATA_GITHUB_BRANCH || 'busline-data', token: process.env.CITY_DATA_GITHUB_TOKEN || '',
  enabled: process.env.CITY_DATA_ENABLED === 'true' });
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
const routePath = (city: string) => `city-data/v1/${cityDataKey(city)}`;
const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');

/** Run `fn` over `items` with bounded concurrency, preserving result order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Atomic two-file commits, optimistic ref updates and bounded conflict retries. */
export class GithubCityStore {
  constructor(private settings: Config, private transport: Transport = fetch) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(settings.repo) || !/^[\w/-]+$/.test(settings.branch) || settings.branch.includes('..')) throw apiError(503, '共享数据仓库配置无效。');
  }
  private async api(path: string, method = 'GET', body?: unknown, raw = false): Promise<any> {
    const response = await this.transport(`https://api.github.com/repos/${this.settings.repo}${path}`, {
      method, headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        Authorization: `Bearer ${this.settings.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw apiError(response.status, response.status === 404 ? '共享数据不存在。' : `共享仓库请求失败（${response.status}）。`);
    return response.json();
  }
  private async file(path: string, ref = this.settings.branch): Promise<any | null> {
    try { return await this.api(`/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, 'GET', undefined, true); }
    catch (error: any) { if (error.status === 404) return null; throw error; }
  }
  async latest(city: string): Promise<CityDataset | null> {
    const result = await this.file(`${routePath(city)}/latest.json`);
    return result ? normalizeCityDataset(await resolveCityParts(result, part => this.file(`${routePath(city)}/${part}`))) : null;
  }
  async history(city: string): Promise<CitySnapshotMeta[]> {
    return (await this.file(`${routePath(city)}/history.json`)) || [];
  }
  async historical(city: string, id: string): Promise<CityDataset | null> {
    if (!/^[\dTZ-]+-[a-f0-9]{12}$/.test(id)) throw apiError(400, '快照版本无效。');
    const result = await this.file(`${routePath(city)}/history/${id}.json`);
    return result ? normalizeCityDataset(await resolveCityParts(result, part => this.file(`${routePath(city)}/${part}`))) : null;
  }
  private async head(): Promise<any> {
    try { return await this.api(`/git/ref/heads/${encodePath(this.settings.branch)}`); }
    catch (error: any) {
      if (error.status !== 404) throw error;
      const repo = await this.api('');
      const base = await this.api(`/git/ref/heads/${encodePath(repo.default_branch)}`);
      try { await this.api('/git/refs', 'POST', { ref: `refs/heads/${this.settings.branch}`, sha: base.object.sha }); }
      catch (creation: any) { if (creation.status !== 422) throw creation; }
      return this.api(`/git/ref/heads/${encodePath(this.settings.branch)}`);
    }
  }
  async publish(input: unknown) {
    let data: CityDataset;
    try { data = normalizeCityDataset(input); } catch (error: any) { throw apiError(400, error.message); }
    cityContentBytes(data);
    if (data.filtered) throw apiError(400, '开启线路过滤时不能发布全市共享快照。');
    if (Date.parse(data.capturedAt) > Date.now() + 300000 || Date.parse(data.capturedAt) < Date.now() - 86400000) throw apiError(400, '请提交最近完成的城市检索。');
    const hash = cityContentHash(data);
    const id = `${data.capturedAt.replace(/[:.]/g, '-')}-${hash.slice(0, 12)}`;
    const prefix = routePath(data.city);
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await this.head();
      const commit = await this.api(`/git/commits/${head.object.sha}`);
      // Read all comparison files at the same immutable commit, never mixed revisions.
      const [oldFile, records] = await Promise.all([
        this.file(`${prefix}/latest.json`, head.object.sha), this.file(`${prefix}/history.json`, head.object.sha),
      ]);
      const old = oldFile ? await resolveCityParts(oldFile, part => this.file(`${prefix}/${part}`, head.object.sha)) : null;
      const history: CitySnapshotMeta[] = Array.isArray(records) ? records : [];
      const oldStable = old ? { ...normalizeCityDataset(old), capturedAt: '' } : null;
      const oldHash = oldStable ? cityContentHash(oldStable) : '';
      if (hash === oldHash && Date.parse(data.capturedAt) <= Date.parse(old.capturedAt)) return { saved: false, promoted: false, unchanged: true, id: history.find(item => item.hash === hash)?.id };
      const promoted = !old || Date.parse(data.capturedAt) >= Date.parse(old.capturedAt);
      const meta: CitySnapshotMeta = { id, city: data.city, capturedAt: data.capturedAt, hash,
        lineDirections: data.lines.length, stops: data.stops.length, retrievalComplete: data.retrievalComplete, promoted };
      const retained = [meta, ...history.filter(item => item.id !== id)]
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)).slice(0, 5);
      // An older delayed upload must not displace the current snapshot or exceed retention.
      if (!retained.some(item => item.id === id)) return { saved: false, promoted: false, unchanged: true };
      const removed = history.filter(item => !retained.some(keep => keep.id === item.id));
      const files = [
        { path: `${prefix}/history.json`, content: JSON.stringify(retained) },
        ...(promoted ? [
          { path: `${prefix}/meta.json`, content: JSON.stringify({ schemaVersion: 1, city: data.city,
            capturedAt: data.capturedAt, expiresAt: cityDatasetExpiresAt(data), retrievalComplete: data.retrievalComplete,
            filtered: data.filtered, lineDirections: data.lines.length, stops: data.stops.length, snapshotId: id }) },
        ] : []),
      ];
      const newFiles = [...(function* () { yield* cityStorageFiles(data, prefix, id, promoted); yield* files; })()];
      const blobs = await mapLimit(newFiles, 8, (file) => this.api('/git/blobs', 'POST', { content: file.content, encoding: 'utf-8' }));
      const treeEntries: { path: string; mode: string; type: string; sha: string | null }[] = newFiles.map((file, index) => ({ path: file.path, mode: '100644', type: 'blob', sha: blobs[index].sha }));
      const liveParts = new Set<string>();
      const preserveParts = (manifest: any) => { if (isCityParts(manifest)) for (const part of manifest.parts) liveParts.add(validateCityPart(part)); };
      if (!promoted) preserveParts(oldFile);
      const retainedManifests = await mapLimit(retained.filter(record => record.id !== id), 8, (record) => this.file(`${prefix}/history/${record.id}.json`, head.object.sha));
      for (const manifest of retainedManifests) preserveParts(manifest);
      for (const entry of treeEntries) if (entry.path.startsWith(`${prefix}/parts/`)) liveParts.add(entry.path.slice(prefix.length + 1));
      for (const record of removed) {
        if (!/^[\dTZ-]+-[a-f0-9]{12}$/.test(record.id)) throw apiError(400, '历史版本无效。');
        const path = `${prefix}/history/${record.id}.json`;
        const manifest = await this.file(path, head.object.sha);
        if (!manifest) continue;
        treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
        if (isCityParts(manifest)) for (const part of manifest.parts) {
          validateCityPart(part);
          if (!liveParts.has(part) && !treeEntries.some(entry => entry.path === `${prefix}/${part}`))
            treeEntries.push({ path: `${prefix}/${part}`, mode: '100644', type: 'blob', sha: null });
        }
      }
      const tree = await this.api('/git/trees', 'POST', { base_tree: commit.tree.sha, tree: treeEntries });
      const next = await this.api('/git/commits', 'POST', { message: `data: ${data.city} snapshot ${id}`, tree: tree.sha, parents: [head.object.sha] });
      try {
        await this.api(`/git/refs/heads/${encodePath(this.settings.branch)}`, 'PATCH', { sha: next.sha, force: false });
        return { saved: true, promoted, unchanged: false, id };
      } catch (error: any) { if (![409, 422].includes(error.status) || attempt === 2) throw error; }
    }
    throw apiError(409, '共享数据正在更新，请稍后再试。');
  }
}

const activeWrites = new Map<string, Promise<any>>();
const reads = new Map<string, { expires: number; value: any; bytes: number }>();
const MAX_READ_BYTES = 32 * 1024 * 1024;
const readTasks = new Map<string, Promise<any>>();
const refreshLeases = new Map<string, { token: string; expiresAt: number }>();
const leaseRequests = new Map<string, Promise<any>>();
const refreshBackoff = new Map<string, number>();
const authenticated = (password: string) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected === 'buslineadmin' || expected.length < 12) return false;
  const left = Buffer.from(password || ''), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

export async function handleCityDataRequest(method: string, pathname: string, body?: any, password = '', refreshToken = '') {
  try {
    const settings = config();
    if (!settings.enabled || !settings.token) return { status: 503, body: { error: '共享城市数据尚未配置。' } };
    const parts = pathname.replace(/^\/api\/city-data\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const city = parts[0];
    try { cityDataKey(city); } catch { throw apiError(400, '城市名称无效。'); }
    const store = new GithubCityStore(settings);
    const leaseKey = `${settings.repo}:${settings.branch}:${cityDataKey(city)}`;
    if (method === 'DELETE' && parts.length === 2 && parts[1] === 'refresh') {
      const lease = refreshLeases.get(leaseKey);
      if (!lease || !/^[a-f0-9]{64}$/.test(refreshToken) || !timingSafeEqual(Buffer.from(refreshToken), Buffer.from(lease.token))) return { status: 401, body: { error: '更新凭据无效。' } };
      refreshLeases.delete(leaseKey);
      return { status: 200, body: { released: true } };
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'refresh') {
      for (const [key, lease] of refreshLeases) if (lease.expiresAt <= Date.now()) refreshLeases.delete(key);
      for (const [key, expiry] of refreshBackoff) if (expiry <= Date.now()) refreshBackoff.delete(key);
      if (activeWrites.has(leaseKey) || refreshLeases.has(leaseKey) || leaseRequests.has(leaseKey) || (refreshBackoff.get(leaseKey) || 0) > Date.now()) return { status: 409, body: { error: '该城市正在更新或刚刚尝试更新，请稍后再试。' } };
      if (refreshLeases.size + leaseRequests.size >= 100) return { status: 503, body: { error: '当前更新任务较多，请稍后再试。' } };
      const task = (async () => {
        const latest = await store.latest(city);
        if (latest && usableCityDataset(latest)) {
          refreshBackoff.set(leaseKey, Date.now() + 60000);
          return { status: 409, body: { error: '该城市数据仍在两个月有效期内，无需重新检索。' } };
        }
        const lease = { token: randomBytes(32).toString('hex'), expiresAt: Date.now() + 30 * 60000 };
        refreshLeases.set(leaseKey, lease);
        return { status: 200, body: lease };
      })();
      leaseRequests.set(leaseKey, task);
      try { return await task; } finally { leaseRequests.delete(leaseKey); }
    }
    if (method === 'GET' && (parts.length === 1 || parts[1] === 'history')) {
      const key = `${settings.repo}:${settings.branch}:${parts.join('/')}`;
      const cached = reads.get(key);
      if (cached && cached.expires > Date.now()) return { status: 200, body: cached.value };
      let task = readTasks.get(key);
      if (!task) {
        task = (parts.length === 1 ? store.latest(city) : parts[2] ? store.historical(city, parts[2]) : store.history(city));
        readTasks.set(key, task);
      }
      let value: any;
      try { value = await task; } finally { if (readTasks.get(key) === task) readTasks.delete(key); }
      if (!value) return { status: 404, body: { error: '尚无该城市共享数据。' } };
      const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
      for (const [cacheKey, entry] of reads) if (entry.expires <= Date.now()) reads.delete(cacheKey);
      if (bytes <= MAX_READ_BYTES) {
        let total = [...reads.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        for (const [cacheKey, entry] of reads) {
          if (total + bytes <= MAX_READ_BYTES && reads.size < 100) break;
          reads.delete(cacheKey); total -= entry.bytes;
        }
        reads.set(key, { value, bytes, expires: Date.now() + 60000 });
      }
      return { status: 200, body: value };
    }
    if (method !== 'POST' || parts.length !== 1) return { status: 405, body: { error: '不支持的请求。' } };
    const lease = refreshLeases.get(leaseKey);
    const validLease = lease && lease.expiresAt > Date.now() && /^[a-f0-9]{64}$/.test(refreshToken)
      && timingSafeEqual(Buffer.from(refreshToken), Buffer.from(lease.token));
    if (!validLease && !authenticated(password)) return { status: 401, body: { error: '需要先取得该城市的检索更新凭据。' } };
    try { cityDataKey(body?.city); } catch { throw apiError(400, '城市快照无效。'); }
    if (cityDataKey(body?.city) !== cityDataKey(city)) throw apiError(400, '城市与快照不一致。');
    cityContentBytes(body);
    const key = `${settings.repo}:${settings.branch}:${cityDataKey(city)}`;
    if (activeWrites.has(key)) return { status: 409, body: { error: '该城市正在保存，请稍后再试。' } };
    const task = store.publish(body);
    activeWrites.set(key, task);
    try {
      const result = await task;
      refreshLeases.delete(leaseKey);
      refreshBackoff.set(leaseKey, Date.now() + 5 * 60000);
      for (const cacheKey of reads.keys()) if (cacheKey.startsWith(`${settings.repo}:${settings.branch}:`)) reads.delete(cacheKey);
      return { status: 200, body: result };
    } finally { activeWrites.delete(key); }
  } catch (error: any) {
    const status = [400, 401, 404, 409, 413, 503].includes(error.status) ? error.status : 502;
    return { status, body: { error: status === 502 ? '共享仓库暂时不可用，请稍后重试。' : error.message } };
  }
}
