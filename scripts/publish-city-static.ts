import {provinceForCity,savedCountySeats} from '../src/utils/localTransit';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCityParts, validateCityPart, CITY_FILE_BYTES } from '../src/utils/cityStorage';
import { cityDataKey } from '../src/utils/cityDataset';
import {CityOverviewTiles,TILE_MIN_ZOOM,TILE_MAX_ZOOM,TILE_PIXEL_RATIO} from './city-overview-tiles';
import {cityOverviewPNG} from './city-overview-png';
import { cityThumbnail, type CityOverview } from '../src/utils/cityOverview';
import { resolveCityParts } from '../src/utils/cityStorage';
import { cityStorageFiles } from './city-storage-files';

const snapshotId = /^[\dTZ-]+-[a-f0-9]{12}$/;
/** Publish latest AND indexed history, including all referenced immutable pieces. No live gateway is needed to read. */
export async function mirrorCitySnapshots(ref: string, output = 'public', repo = process.cwd()) {
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 35 * 1024 * 1024 });
  const commit = git(['rev-parse', '--verify', ref]).trim();
  const files = new Set(git(['ls-tree', '-r', '-z', '--name-only', commit, '--', 'city-data/v1']).split('\0').filter(Boolean));
  const source = (path: string) => {
    if (!files.has(path)) throw Error(`Missing shared city file: ${path}`);
    return git(['show', `${commit}:${path}`]);
  };
  let bytes = 0, cities = 0, historySnapshots = 0;
  const overviews:CityOverview[]=[];
  const tiles=new CityOverviewTiles();
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
    const latest=await resolveCityParts(JSON.parse(source(file)),async part=>JSON.parse(source(`${prefix}/${part}`)));
    tiles.add(latest);
    const thumbnail=cityThumbnail(latest);
    if(thumbnail){const name=`thumbnails/${city}-geo-v3.png`;await copy(`city-data/v1/${name}`,cityOverviewPNG(thumbnail.raster));overviews.push({...thumbnail.meta,province:provinceForCity(latest.city),countySeats:savedCountySeats(latest),thumbnail:`thumbnails/${encodeURIComponent(city)}-geo-v3.png`});}
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
  return { cities, historySnapshots, bytes, commit };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', 'busline-data'], { stdio: 'pipe' });
    execFileSync('git', ['fetch', '--depth=1', '--filter=blob:none', 'origin', 'busline-data'], { stdio: 'inherit' });
    console.log(await mirrorCitySnapshots('FETCH_HEAD'));
  } catch (error: any) {
    if (error.status === 2) console.log('No shared city data branch yet.');
    else { console.error('Unable to publish shared city snapshots:', error.message); process.exitCode = 1; }
  }
}
