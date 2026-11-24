import {provinceForCity,savedCountySeats} from '../src/utils/localTransit';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, writeFile, mkdtemp, rename, rm, readFile } from 'node:fs/promises';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCityParts, validateCityPart, CITY_FILE_BYTES } from '../src/utils/cityStorage';
import { cityDataKey } from '../src/utils/cityDataset';
import {CityOverviewTiles,TILE_MIN_ZOOM,TILE_MAX_ZOOM,TILE_PIXEL_RATIO} from './city-overview-tiles';
import {cityOverviewPNG} from './city-overview-png';
import { cityThumbnail, type CityOverview } from '../src/utils/cityOverview';
import { cityBvpkManifest, cityBvpkPartPath, resolveCityStorage } from '../src/utils/cityBvpk';
import { readNodeCityBvpkPart, verifyNodeCityBvpkPart } from './city-bvpk-files';
import { TransitTilePublisher } from './transit-tiles';
import { TRANSIT_TILE_BASE, type TransitTileIndex } from '../src/utils/transitTiles';
import { cityStorageFiles } from './city-storage-files';

const CITY_OVERVIEW_RASTER_VERSION = 3;
// GitHub Pages has a 1 GiB site limit.  The source branch intentionally keeps
// readable JSON, but the static mirror must split and gzip sizeable legacy
// snapshots or latest/history copies exhaust that limit before deployment.
const STATIC_CITY_PART_BYTES = 512 * 1024;
interface CityLayer { id: string; overview: CityOverview; thumbnail: Buffer; coverage: Buffer; }
interface CityContribution { fingerprint: string; groups: string[]; overviewKeys: string[]; }
interface PublicationCache { version: 1; cities: Record<string, CityContribution>; }
const PUBLICATION_CACHE_VERSION = 1;

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return undefined; }
}

/** Copy a previous successful publication before replacing changed files. */
async function restorePublication(cacheDir: string, output: string): Promise<boolean> {
  const from = join(cacheDir, 'static', 'city-data', 'v1');
  if (!existsSync(join(from, 'transit.json')) || !existsSync(join(from, 'overview.json'))) return false;
  await cp(from, join(output, 'city-data', 'v1'), { recursive: true });
  return true;
}

async function savePublication(cacheDir: string, output: string): Promise<void> {
  const target = join(cacheDir, 'static', 'city-data', 'v1');
  const staging = `${target}.next`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(staging), { recursive: true });
  await cp(join(output, 'city-data', 'v1'), staging, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
}

function loadLayers(layersDir: string): Map<string, CityLayer> {
  const layers = new Map<string, CityLayer>();
  if (!existsSync(layersDir)) return layers;
  for (const entry of readdirSync(layersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(layersDir, entry.name);
    const metaPath = join(dir, 'meta.json'), covPath = join(dir, 'coverage.gz'), thumbPath = join(dir, 'thumb.png');
    if (!existsSync(metaPath) || !existsSync(covPath) || !existsSync(thumbPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta.rasterVersion !== CITY_OVERVIEW_RASTER_VERSION || typeof meta.id !== 'string' || !meta.overview || typeof meta.overview.city !== 'string') continue;
      layers.set(entry.name, { id: meta.id, overview: meta.overview, thumbnail: readFileSync(thumbPath), coverage: readFileSync(covPath) });
    } catch { /* skip corrupt layer */ }
  }
  return layers;
}

async function saveLayers(layersDir: string, layers: Map<string, CityLayer>): Promise<void> {
  for (const [key, layer] of layers) {
    const dir = join(layersDir, key);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'coverage.gz'), layer.coverage);
    await writeFile(join(dir, 'thumb.png'), layer.thumbnail);
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ rasterVersion: CITY_OVERVIEW_RASTER_VERSION, id: layer.id, overview: layer.overview }));
  }
}

const snapshotId = /^[\dTZ-]+-[a-f0-9]{12}$/;
/** Publish latest AND indexed history, including all referenced immutable pieces. No live gateway is needed to read. */
export async function mirrorCitySnapshots(ref: string, output = 'public', repo = process.cwd(), layersDir?: string, publicationCacheDir?: string) {
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 35 * 1024 * 1024 });
  const commit = git(['rev-parse', '--verify', ref]).trim();
  const files = new Set(git(['ls-tree', '-r', '-z', '--name-only', commit, '--', 'city-data/v1']).split('\0').filter(Boolean));
  const sourceBytes = (path: string) => {
    if (!files.has(path)) throw Error(`Missing shared city file: ${path}`);
    return execFileSync('git', ['show', `${commit}:${path}`], { cwd: repo, maxBuffer: 35 * 1024 * 1024 });
  };
  const source = (path: string) => sourceBytes(path).toString('utf8');
  let bytes = 0, cities = 0, historySnapshots = 0, reused = 0;
  const overviews:CityOverview[]=[];
  const tileCache=await mkdtemp(join(tmpdir(),'busline-tile-work-'));
  const tiles=new CityOverviewTiles({cacheDirectory:tileCache,maxResidentTiles:128});
  const transit=new TransitTilePublisher(join(tileCache,'transit'));
  const cachedLayers=layersDir?loadLayers(layersDir):new Map<string,CityLayer>();
  const newLayers=new Map<string,CityLayer>();
  const cacheFile = publicationCacheDir ? join(publicationCacheDir, 'manifest.json') : '';
  const previousCache = publicationCacheDir ? await readJson<PublicationCache>(cacheFile) : undefined;
  const previousCities = previousCache?.version === PUBLICATION_CACHE_VERSION ? previousCache.cities : {};
  const restored = publicationCacheDir ? await restorePublication(publicationCacheDir, output) : false;
  const contributions = new Map<string, CityContribution>();
  const changed = new Set<string>();
  try {
  const copied = new Set<string>();
  const copy = async (path: string, content: string | Uint8Array) => {
    if (copied.has(path)) return;
    bytes += typeof content==='string'?Buffer.byteLength(content):content.byteLength;
    if (bytes > 900 * 1024 * 1024) throw Error('Shared city files exceed static publication budget');
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), content); copied.add(path);
  };
  const snapshot = async (prefix: string, path: string, id?: string) => {
    const content = source(path), parsed = JSON.parse(content);
    const manifest = cityBvpkManifest(parsed);
    if (manifest) {
      if (id && manifest.snapshotId !== id) throw Error(`BVPK1 snapshot identity mismatch: ${path}`);
      if (cityDataKey(manifest.header.city) !== prefix.split('/').at(-1)) throw Error(`BVPK1 city mismatch: ${path}`);
      for (const descriptor of manifest.parts) {
        const partPath = `${prefix}/${cityBvpkPartPath(descriptor)}`;
        const bytes = sourceBytes(partPath);
        verifyNodeCityBvpkPart(descriptor, bytes);
        await copy(partPath, bytes);
      }
      await copy(path, content);
      return parsed;
    }
    if (parsed?.storage !== undefined && !isCityParts(parsed)) throw Error(`Unknown city storage: ${path}`);
    // Repack sizeable legacy single files only in the static build; the
    // repository/history remains untouched.  Identical latest/history content
    // shares the same immutable gzip parts through `copied`.
    if (!isCityParts(parsed) && parsed.schemaVersion === 1 && Buffer.byteLength(content) > STATIC_CITY_PART_BYTES) {
      const name = `${new Date(parsed.capturedAt).toISOString().replace(/[:.]/g, '-')}-${createHash('sha256').update(content).digest('hex').slice(0, 12)}`;
      if (!snapshotId.test(name)) throw Error('Invalid snapshot identity');
      let staticFiles;
      try {
        staticFiles = [...cityStorageFiles(parsed, prefix, name, false, STATIC_CITY_PART_BYTES)];
      } catch (error: any) {
        // An exceptionally long single route cannot fit the smaller static
        // chunks.  Retain the established 8 MiB compatibility limit for it.
        if (!/单条线路超过分片上限/.test(error?.message || '')) throw error;
        staticFiles = [...cityStorageFiles(parsed, prefix, name, false, CITY_FILE_BYTES)];
      }
      for (const file of staticFiles) {
        await copy(file.path.startsWith(`${prefix}/history/`) ? path : file.path, file.content);
      }
    } else {
      await copy(path, content);
      if (isCityParts(parsed)) {
        if (!Array.isArray(parsed.parts) || parsed.parts.length > 256) throw Error('Invalid city parts manifest');
        for (const part of parsed.parts) {
          const partPath = `${prefix}/${validateCityPart(part)}`, partContent = source(partPath);
          JSON.parse(partContent); await copy(partPath, partContent);
        }
      }
    }
    return parsed;
  };
  for (const file of files) {
    const match = /^city-data\/v1\/([^/]+)\/latest\.json$/.exec(file);
    if (!match) continue;
    const city = match[1];
    if (cityDataKey(city) !== city) throw Error('Invalid shared city path');
    const prefix = `city-data/v1/${city}`;
    const metaPath = `${prefix}/meta.json`, historyPath = `${prefix}/history.json`;
    let currentId: string | undefined;
    if (files.has(metaPath)) {
      const text = source(metaPath), meta = JSON.parse(text);
      if (typeof meta.snapshotId === 'string' && snapshotId.test(meta.snapshotId)) currentId = meta.snapshotId;
    }
    // Git object ids are content hashes.  Coupling this to snapshotId catches an
    // accidental mutable snapshot without loading an unchanged legacy dataset.
    const fingerprint = `${currentId ?? 'legacy'}:${git(['rev-parse', `${commit}:${file}`]).trim()}`;
    const cached=cachedLayers.get(city);
    const previous = previousCities[city];
    const contributionDir = publicationCacheDir ? join(publicationCacheDir, 'transit', city) : '';
    const unchanged = Boolean(publicationCacheDir && restored && previous?.fingerprint === fingerprint && existsSync(contributionDir) && cached?.id === fingerprint);
    cities++;
    if (unchanged) {
      reused++;
      overviews.push(cached.overview);
      contributions.set(city, previous);
    }else{
      changed.add(city);
      if (files.has(metaPath)) await copy(metaPath, source(metaPath));
      const active = await snapshot(prefix, file, currentId);
      const latest = await resolveCityStorage(active, async part => JSON.parse(source(`${prefix}/${part}`)),
        descriptor => readNodeCityBvpkPart(descriptor, async part => sourceBytes(`${prefix}/${part}`)));
      const cityTransit = new TransitTilePublisher(join(tileCache, 'contributions', city));
      cityTransit.add(latest);
      const cityTiles=new CityOverviewTiles({cacheDirectory:join(tileCache,city),maxResidentTiles:128});
      const reusedLayer=!publicationCacheDir&&Boolean(cached&&currentId&&cached.id===currentId);
      if(reusedLayer){
        reused++; cityTiles.mergeSerializedLayer(cached!.coverage); overviews.push(cached!.overview);
      }else cityTiles.add(latest);
      const overviewKeys=cityTiles.keys;
      const contribution:CityContribution={fingerprint,groups:[...cityTransit.groups()].sort(),overviewKeys};
      contributions.set(city,contribution);
      if(publicationCacheDir){
        const destination=contributionDir, staging=`${destination}.next`;
        await rm(staging,{recursive:true,force:true}); await mkdir(dirname(destination),{recursive:true});
        await rename(join(tileCache, 'contributions', city),staging);
        await rm(destination,{recursive:true,force:true}); await rename(staging,destination);
      }
      const thumb=reusedLayer?null:cityThumbnail(latest);
      if(thumb){
        const thumbPng=cityOverviewPNG(thumb.raster);
        await copy(`city-data/v1/thumbnails/${city}-geo-v3.png`,thumbPng);
        const overview:CityOverview={...thumb.meta,province:provinceForCity(latest.city),countySeats:savedCountySeats(latest),thumbnail:`thumbnails/${encodeURIComponent(city)}-geo-v3.png`};
        overviews.push(overview);
        newLayers.set(city,{id:publicationCacheDir?fingerprint:(currentId||''),overview,thumbnail:thumbPng,coverage:cityTiles.serializeLayer()});
      }
    }
    console.log(`Prepared ${city}${unchanged ? ' (reused)' : ''}`);
    if (!unchanged && files.has(historyPath)) {
      const text = source(historyPath), records = JSON.parse(text);
      await copy(historyPath, text);
      if (Array.isArray(records)) for (const record of records) {
        if (!snapshotId.test(record.id || '')) throw Error('Invalid city history identity');
        await snapshot(prefix, `${prefix}/history/${record.id}.json`, record.id); historySnapshots++;
      }
    }
  }
  // A disappeared city must not leave stale snapshots or a stale contribution
  // in the next publication.  Its former shared tiles are rebuilt below.
  for (const city of Object.keys(previousCities)) if (!contributions.has(city)) {
    changed.add(city);
    await rm(join(output, 'city-data/v1', city), { recursive: true, force: true });
    await rm(join(output, 'city-data/v1/thumbnails', `${city}-geo-v3.png`), { force: true });
  }
  const tileBase='tiles/xyz-v1';
  const effectiveLayers=new Map(cachedLayers); for(const [city,layer] of newLayers)effectiveLayers.set(city,layer);
  const affectedOverview=new Set<string>();
  for(const city of changed){for(const key of previousCities[city]?.overviewKeys||[])affectedOverview.add(key);for(const key of contributions.get(city)?.overviewKeys||[])affectedOverview.add(key);}
  if(!restored)for(const contribution of contributions.values())for(const key of contribution.overviewKeys)affectedOverview.add(key);
  for(const layer of effectiveLayers.values())tiles.mergeSerializedLayer(layer.coverage,affectedOverview);
  for(const file of tiles.files(`city-data/v1/${tileBase}`))await copy(file.path,file.content);

  const cachedTransit=restored?await readJson<TransitTileIndex>(join(output,'city-data/v1/transit.json')):undefined;
  const allGroups=new Set<string>(); for(const contribution of contributions.values())for(const group of contribution.groups)allGroups.add(group);
  const affectedGroups=new Set<string>();
  for(const city of changed){for(const group of previousCities[city]?.groups||[])affectedGroups.add(group);for(const group of contributions.get(city)?.groups||[])affectedGroups.add(group);}
  if(!cachedTransit?.groups)for(const group of allGroups)affectedGroups.add(group);
  const groups: TransitTileIndex['groups'] = {...(cachedTransit?.groups||{})};
  for(const group of affectedGroups){
    const old=groups[group]; if(old)await rm(join(output,'city-data/v1',TRANSIT_TILE_BASE,`${group}-${old[1]}.pack`),{force:true});
    delete groups[group];
  }
  if(publicationCacheDir) for(const [city,contribution] of contributions){
    if(contribution.groups.some(group=>affectedGroups.has(group))) transit.addDirectory(join(publicationCacheDir, 'transit', city),affectedGroups);
  }
  // Fresh contributions live under the temporary work directory until the
  // optional persistent cache is enabled.
  if(!publicationCacheDir) for(const [city,contribution] of contributions){
    if(contribution.groups.some(group=>affectedGroups.has(group))) transit.addDirectory(join(tileCache,'contributions',city),affectedGroups);
  }
  for (const file of transit.files(affectedGroups)) {
    await copy(file.path, file.content);
    groups[file.key] = file.descriptor;
  }
  for(const group of Object.keys(groups))if(!allGroups.has(group))delete groups[group];
  const overviewKeys=[...new Set([...contributions.values()].flatMap(contribution=>contribution.overviewKeys))].sort();
  // Write indexes last.  A deployed reader therefore sees all immutable
  // snapshots and packs before an index can point at them.
  await copy('city-data/v1/transit.json', JSON.stringify({ schemaVersion: 1, base: TRANSIT_TILE_BASE, revision: commit, groups }));
  const overviewRevision = createHash('sha1').update(`${commit}:raster:${CITY_OVERVIEW_RASTER_VERSION}`).digest('hex');
  await copy('city-data/v1/overview.json',JSON.stringify({schemaVersion:3,cities:overviews,tiles:{base:tileBase,pixelRatio:TILE_PIXEL_RATIO,revision:overviewRevision,minZoom:TILE_MIN_ZOOM,maxZoom:TILE_MAX_ZOOM,keys:overviewKeys}}));
  await mkdir(join(output, 'city-data/v1'), { recursive: true });
  await writeFile(join(output, 'city-data/v1/publication.json'), JSON.stringify({ commit, cities, historySnapshots, bytes, publishedAt: new Date().toISOString() }));
  if(layersDir)await saveLayers(layersDir,newLayers);
  if(publicationCacheDir){
    await savePublication(publicationCacheDir,output);
    await mkdir(publicationCacheDir,{recursive:true});
    await writeFile(cacheFile,JSON.stringify({version:PUBLICATION_CACHE_VERSION,cities:Object.fromEntries(contributions)} satisfies PublicationCache));
  }
  return { cities, historySnapshots, bytes, commit, reused };
  } finally {await rm(tileCache,{recursive:true,force:true});}
}
// ---- 发布步骤的仓库解析：Vercel 构建环境没有 `origin` 远程 ----

export function resolveRepoUrl(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): { url: string; via: string } {
  for (const remote of ['origin', 'upstream']) {
    try {
      const url = execFileSync('git', ['remote', 'get-url', remote], { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
      if (url) return { url, via: remote };
    } catch { /* try the next remote */ }
  }
  const owner = (env.VERCEL_GIT_REPO_OWNER || '').trim();
  const slug = (env.VERCEL_GIT_REPO_SLUG || '').trim();
  if (owner && slug) return { url: `https://github.com/${owner}/${slug}.git`, via: 'vercel-env' };
  return { url: 'https://github.com/tsfeng6/busline.git', via: 'default' };
}

export function authenticatedUrl(url: string, token: string | undefined): string {
  if (!token) return url;
  return url.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`);
}

export function redact(text: string, token: string | undefined): string {
  return token ? text.split(token).join('[REDACTED]') : text;
}

function describeGitError(stderr: string, phase: '查询' | '拉取'): string {
  const line = stderr.split('\n').map((s) => s.trim()).find(Boolean) || stderr;
  if (/authentication failed|could not read username|not authorized|permission denied|invalid username|403/i.test(stderr)) {
    return `权限错误（GitHub 认证失败）：${line}`;
  }
  if (/repository.*not found|not found|does not appear to be a git repository|404/i.test(stderr)) {
    return `仓库不存在或名称错误：${line}`;
  }
  if (/could not resolve host|unable to access|failed to connect|timed out|connection (reset|refused)|network/i.test(stderr)) {
    return `网络错误（无法连接 GitHub）：${line}`;
  }
  return `${phase} busline-data 分支失败：${line}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITHUB_TOKEN || undefined;
  const { url, via } = resolveRepoUrl();
  const remote = authenticatedUrl(url, token);
  console.log(`Publishing shared city snapshots from ${url} (busline-data, resolved via ${via})`);
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', remote, 'busline-data'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: any) {
    if (error?.status === 2) { console.log('No shared city data branch yet.'); process.exit(0); }
    console.error(describeGitError(redact(String(error?.stderr || ''), token), '查询'));
    process.exit(1);
  }
  try {
    // Full shallow fetch by explicit URL: `git show` then needs no lazy blob fetch from a promisor remote.
    execFileSync('git', ['fetch', '--depth=1', remote, 'busline-data'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: any) {
    console.error(describeGitError(redact(String(error?.stderr || ''), token), '拉取'));
    process.exit(1);
  }
  try {
    console.log(await mirrorCitySnapshots('FETCH_HEAD', 'public', process.cwd(), process.env.CITY_LAYERS_DIR || '.city-layers', process.env.CITY_PUBLICATION_CACHE_DIR || '.city-publication-cache'));
  } catch (error: any) {
    console.error('Unable to publish shared city snapshots:', redact(error.message, token));
    process.exit(1);
  }
}
