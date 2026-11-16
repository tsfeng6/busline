import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cityDataKey } from '../src/utils/cityDataset';

export async function mirrorCitySnapshots(ref:string,output='public',repo=process.cwd()){
  const git=(args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8',maxBuffer:35*1024*1024});
  const commit=git(['rev-parse','--verify',ref]).trim();
  const files=git(['ls-tree','-r','-z','--name-only',commit,'--','city-data/v1']).split('\0').filter(Boolean);
  let bytes=0,cities=0;
  for(const file of files){
    const match=/^city-data\/v1\/([^/]+)\/(latest|meta|history)\.json$/.exec(file);
    if(!match)continue;
    if(cityDataKey(match[1])!==match[1])throw Error('Invalid shared city path');
    const content=git(['show',`${commit}:${file}`]);
    JSON.parse(content);
    bytes+=Buffer.byteLength(content);
    if(bytes>500*1024*1024)throw Error('Shared city files exceed static publication budget');
    await mkdir(join(output,'city-data/v1',match[1]),{recursive:true});
    await writeFile(join(output,file),content);
    if(match[2]==='latest')cities++;
  }
  await mkdir(join(output,'city-data/v1'),{recursive:true});
  await writeFile(join(output,'city-data/v1/publication.json'),JSON.stringify({commit,cities,bytes,publishedAt:new Date().toISOString()}));
  return {cities,bytes,commit};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    // Missing data branch is valid for a new installation; network/auth failures are not.
    execFileSync('git',['ls-remote','--exit-code','--heads','origin','busline-data'],{stdio:'pipe'});
    execFileSync('git',['fetch','--depth=1','--filter=blob:none','origin','busline-data'],{stdio:'inherit'});
    console.log(await mirrorCitySnapshots('FETCH_HEAD'));
  }catch(error:any){if(error.status===2)console.log('No shared city data branch yet.');else{console.error('Unable to publish shared city snapshots:',error.message);process.exitCode=1;}}
}
