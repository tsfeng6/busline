import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cityDataKey, cityDatasetExpiresAt, normalizeCityDataset, type CitySnapshotMeta } from '../src/utils/cityDataset';
import { isCityParts, validateCityPart, resolveCityParts } from '../src/utils/cityStorage';

/** Reconcile an existing data checkout. Git history remains available for recovery. */
export async function retainCityHistory(root: string) {
  const base=join(root,'city-data/v1');let cities=0,removed=0;
  for(const entry of await readdir(base,{withFileTypes:true})) {
    if(!entry.isDirectory())continue;
    const city=entry.name;
    const dir=join(base,city);
    if(cityDataKey(city)!==city)throw Error('Invalid city path');
    const read=async(path:string)=>JSON.parse(await readFile(join(dir,path),'utf8'));
    const history:CitySnapshotMeta[]=await read('history.json');
    if(!Array.isArray(history)||!history.length)throw Error(`Missing history: ${city}`);
    const kept=history.slice().sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)).slice(0,5);
    const referenced=new Set<string>();let latest:any;
    for(const record of kept) {
      if(!/^[\dTZ-]+-[a-f0-9]{12}$/.test(record.id))throw Error('Invalid snapshot identity');
      const manifest=await read(`history/${record.id}.json`);
      // Validate all retained data before modifying this city's files.
      const data=normalizeCityDataset(await resolveCityParts(manifest,read));
      if(cityDataKey(data.city)!==city)throw Error('City mismatch');
      if(isCityParts(manifest))for(const part of manifest.parts)referenced.add(validateCityPart(part));
      if(!latest)latest={manifest,data,record};
    }
    const {data,manifest,record}=latest;
    await writeFile(join(dir,'latest.json'),JSON.stringify(manifest));
    await writeFile(join(dir,'meta.json'),JSON.stringify({schemaVersion:1,city:data.city,capturedAt:data.capturedAt,
      expiresAt:cityDatasetExpiresAt(data),retrievalComplete:data.retrievalComplete,filtered:data.filtered,
      lineDirections:data.lines.length,stops:data.stops.length,snapshotId:record.id}));
    await writeFile(join(dir,'history.json'),JSON.stringify(kept.map(item=>({...item,promoted:item.id===record.id}))));
    for(const name of await readdir(join(dir,'history'))) {
      if(!kept.some(item=>name===`${item.id}.json`)){await rm(join(dir,'history',name));removed++;}
    }
    let partDirs:string[]=[];
    try{partDirs=await readdir(join(dir,'parts'));}catch(error:any){if(error.code!=='ENOENT')throw error;}
    for(const id of partDirs) {
      for(const name of await readdir(join(dir,'parts',id))) {
        if(!referenced.has(`parts/${id}/${name}`)){await rm(join(dir,'parts',id,name));removed++;}
      }
      if(!(await readdir(join(dir,'parts',id))).length)await rm(join(dir,'parts',id),{recursive:true});
    }
    cities++;
  }
  return {cities,removed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  retainCityHistory(process.argv[2]||process.cwd()).then(console.log).catch(error=>{console.error(error.message);process.exitCode=1;});
