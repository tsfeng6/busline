import {provinceForCity,savedCountySeats} from '../src/utils/localTransit';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCityParts, validateCityPart, CITY_FILE_BYTES } from '../src/utils/cityStorage';
import { cityDataKey } from '../src/utils/cityDataset';
import {CityOverviewTiles,TILE_MIN_ZOOM,TILE_MAX_ZOOM,TILE_PIXEL_RATIO} from './city-overview-tiles';
import {cityOverviewPNG} from './city-overview-png';
import { cityThumbnail, type CityOverview } from '../src/utils/cityOverview';
import { resolveCityParts } from '../src/utils/cityStorage';
import { cityStorageFiles } from './city-storage-files';

interface CityLayer { id: string; overview: CityOverview; thumbnail: Buffer; coverage: Buffer; }

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
      if (typeof meta.id !== 'string' || !meta.overview || typeof meta.overview.city !== 'string') continue;
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
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: layer.id, overview: layer.overview }));
  }
}

const snapshotId = /^[\dTZ-]+-[a-f0-9]{12}$/;
/** Publish latest AND indexed history, including all referenced immutable pieces. No live gateway is needed to read. */
export async function mirrorCitySnapshots(ref: string, output = 'public', repo = process.cwd(), layersDir?: string) {
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 35 * 1024 * 1024 });
  const commit = git(['rev-parse', '--verify', ref]).trim();
  const files = new Set(git(['ls-tree', '-r', '-z', '--name-only', commit, '--', 'city-data/v1']).split('\0').filter(Boolean));
  const source = (path: string) => {
    if (!files.has(path)) throw Error(`Missing shared city file: ${path}`);
    return git(['show', `${commit}:${path}`]);
  };
  let bytes = 0, cities = 0, historySnapshots = 0, reused = 0;
  const overviews:CityOverview[]=[];
  const tileCache=await mkdtemp(join(tmpdir(),'busline-tile-work-'));
  const tiles=new CityOverviewTiles({cacheDirectory:tileCache,maxResidentTiles:128});
  const cachedLayers=layersDir?loadLayers(layersDir):new Map<string,CityLayer>();
  const newLayers=new Map<string,CityLayer>();
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
    // Repack legacy large single files only in the static build; the repository/history remains untouched.
    if (!isCityParts(parsed) && parsed.schemaVersion === 1 && Buffer.byteLength(content) > CITY_FILE_BYTES) {
      const name = id || `${new Date(parsed.capturedAt).toISOString().replace(/[:.]/g, '-')}-${createHash('sha256').update(content).digest('hex').slice(0, 12)}`;
      if (!snapshotId.test(name)) throw Error('Invalid snapshot identity');
      for (const file of cityStorageFiles(parsed, prefix, name, path.endsWith('/latest.json'))) await copy(file.path, file.content);
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
      await copy(metaPath, text);
    }
    await snapshot(prefix, file, currentId); cities++;
    const cached=cachedLayers.get(city);
    if(cached&&currentId&&cached.id===currentId){
      reused++;
      tiles.mergeSerializedLayer(cached.coverage);
      await copy(`city-data/v1/thumbnails/${city}-geo-v3.png`,cached.thumbnail);
      overviews.push(cached.overview);
    }else{
      const latest=await resolveCityParts(JSON.parse(source(file)),async part=>JSON.parse(source(`${prefix}/${part}`)));
      const cityTiles=new CityOverviewTiles({cacheDirectory:join(tileCache,city),maxResidentTiles:128});
      cityTiles.add(latest);
      tiles.mergeLayer(cityTiles);
      const thumb=cityThumbnail(latest);
      if(thumb){
        const thumbPng=cityOverviewPNG(thumb.raster);
        await copy(`city-data/v1/thumbnails/${city}-geo-v3.png`,thumbPng);
        const overview:CityOverview={...thumb.meta,province:provinceForCity(latest.city),countySeats:savedCountySeats(latest),thumbnail:`thumbnails/${encodeURIComponent(city)}-geo-v3.png`};
        overviews.push(overview);
        newLayers.set(city,{id:currentId||'',overview,thumbnail:thumbPng,coverage:cityTiles.serializeLayer()});
      }
    }
    console.log(`Prepared ${city}: ${tiles.keys.length} tiles; resident raster ${(tiles.residentBytes/1024/1024).toFixed(1)} MiB${cached&&cached.id===currentId?' (reused)':''}`);
    if (files.has(historyPath)) {
      const text = source(historyPath), records = JSON.parse(text);
      await copy(historyPath, text);
      if (Array.isArray(records)) for (const record of records) {
        if (!snapshotId.test(record.id || '')) throw Error('Invalid city history identity');
        await snapshot(prefix, `${prefix}/history/${record.id}.json`, record.id); historySnapshots++;
      }
    }
  }
  const tileBase='tiles/xyz-v1';
  for(const file of tiles.files(`city-data/v1/${tileBase}`))await copy(file.path,file.content);
  await copy('city-data/v1/overview.json',JSON.stringify({schemaVersion:3,cities:overviews,tiles:{base:tileBase,pixelRatio:TILE_PIXEL_RATIO,revision:commit,minZoom:TILE_MIN_ZOOM,maxZoom:TILE_MAX_ZOOM,keys:tiles.keys}}));
  await mkdir(join(output, 'city-data/v1'), { recursive: true });
  await writeFile(join(output, 'city-data/v1/publication.json'), JSON.stringify({ commit, cities, historySnapshots, bytes, publishedAt: new Date().toISOString() }));
  if(layersDir)await saveLayers(layersDir,newLayers);
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
    console.log(await mirrorCitySnapshots('FETCH_HEAD', 'public', process.cwd(), process.env.CITY_LAYERS_DIR || '.city-layers'));
  } catch (error: any) {
    console.error('Unable to publish shared city snapshots:', redact(error.message, token));
    process.exit(1);
  }
}
