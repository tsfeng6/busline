import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cityDataKey, normalizeCityDataset, type CitySnapshotMeta } from '../src/utils/cityDataset';
import { resolveCityStorage } from '../src/utils/cityBvpk';
import { readNodeCityBvpkPart } from './city-bvpk-files';

/** Read-only audit of active snapshots and the indexed archive. */
export async function retainCityHistory(root: string) {
  const base = join(root, 'city-data/v1');
  let cities = 0, snapshots = 0;
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const city = entry.name;
    const dir = join(base, city);
    const read = async (path: string) => JSON.parse(await readFile(join(dir, path), 'utf8'));
    const inspect = async (path: string) => {
      const data = normalizeCityDataset(await resolveCityStorage(await read(path), read, descriptor =>
        readNodeCityBvpkPart(descriptor, part => readFile(join(dir, part)))));
      if (cityDataKey(data.city) !== city) throw Error(`City mismatch: ${city}/${path}`);
    };
    try { await inspect('latest.json'); }
    catch (error: any) {
      // The root may contain folders other than cities and cities with only archived data.
      if (error.code !== 'ENOENT' || error.path !== join(dir, 'latest.json')) throw error;
      continue;
    }
    cities++;
    let history: CitySnapshotMeta[];
    try { history = await read('history.json'); }
    catch (error: any) { if (error.code === 'ENOENT') continue; throw error; }
    if (!Array.isArray(history)) throw Error(`Invalid history index: ${city}`);
    for (const record of history) {
      if (!/^[\dTZ-]+-[a-f0-9]{12}$/.test(record.id)) throw Error('Invalid snapshot identity');
      await inspect(`history/${record.id}.json`);
      snapshots++;
    }
  }
  return { cities, snapshots };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  retainCityHistory(process.argv[2] || process.cwd()).then(console.log).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
