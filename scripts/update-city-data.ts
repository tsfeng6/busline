import { diagnoseCityData } from './diagnose-city-data';
import { createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { GithubCityStore } from '../src/server/cityData';
import { cityDataKey, usableCityDataset } from '../src/utils/cityDataset';
import { collectCityDataset } from './collect-city-data';

export async function runCityUpdate(env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch) {
  const city=env.CITY_UPDATE_CITY||'',id=env.CITY_UPDATE_REQUEST_ID||'';
  cityDataKey(city);
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('更新任务编号无效。');
  const endpoint=new URL(env.CITY_UPDATE_GATEWAY_URL||'https://invalid.local');
  if(endpoint.protocol!=='https:'||endpoint.hostname==='invalid.local'||endpoint.username||endpoint.password)throw new Error('未配置安全的任务回调地址。');
  const secret=env.CITY_UPDATE_CALLBACK_SECRET||'';
  if(secret.length<32)throw new Error('未配置任务回调密钥。');
  const report=async(state:string,message:string,result?:unknown)=>{
    const body=JSON.stringify({id,city,state,message,result,at:Date.now()});
    const signature=createHmac('sha256',secret).update(body).digest('hex');
    const response=await transport(new URL('/jobs/callback',endpoint),{method:'POST',headers:{'Content-Type':'application/json','x-city-signature':signature},body,signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('更新任务已失效或回调不可用，停止本次查询。');
  };
  let claimed=false;
  try {
    // Claim first: expired/duplicate runs stop before consuming upstream quota.
    await report('running','任务已开始，正在检查已有城市数据。');claimed=true;
    const token=env.GITHUB_TOKEN;
    if(!token)throw new Error('未配置仓库写入权限。');
    const store=new GithubCityStore({repo:env.GITHUB_REPOSITORY||'tsfeng6/busline',branch:env.CITY_DATA_GITHUB_BRANCH||'busline-data',token,enabled:true},transport);
    const old=await store.latest(city);
    if(old&&usableCityDataset(old)){
      await report('completed','共享数据仍然有效，已跳过重复检索。',{promoted:true,lineDirections:old.lines.length,stops:old.stops.length});
      return {skipped:true};
    }
    if(!env.AMAP_WEB_SERVICE_KEY)throw new Error('未配置 Web 服务类型的高德 Key。');
    const {dataset,report:collection}=await collectCityDataset(city,env.AMAP_WEB_SERVICE_KEY,{
      fetcher:transport,seed:old||undefined,searchPages:Number(env.CITY_SEARCH_PAGE_LIMIT)||400,lineRequests:Number(env.CITY_LINE_QUERY_LIMIT)||1500,
      onProgress:message=>report('running',message),
    });
    await report('running','线路查询结束，正在校验并保存历史版本。');
    await writeFile('city-update-report.json',JSON.stringify({city:dataset.city,retrievalComplete:dataset.retrievalComplete,...collection},null,2));
    const saved=await store.publish(dataset);
    const after=await store.latest(city);
    const published=!!after&&usableCityDataset(after)&&(saved.promoted||!!saved.unchanged);
    await report(published?'completed':'retained',published?'城市线路已更新，可以查看。':`本次取得 ${dataset.lines.length} 个线路方向，但采集未完整${collection.interruptions[0] ? '：'+collection.interruptions[0].message : '，未发布为完整共享版本。'}`,{
      promoted:published,lineDirections:dataset.lines.length,stops:dataset.stops.length,snapshotId:saved.id||'',
    });
    return {skipped:false,...saved};
  } catch(error:any) {
    if(error.collectionReport)await writeFile('city-update-report.json',JSON.stringify(error.collectionReport,null,2));
    if(claimed)try{await report('failed',String(error.message||'城市更新失败，请稍后重试。').slice(0,180));}catch{/* Expired tasks cannot be revived. */}
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  (process.env.CITY_UPDATE_DIAGNOSTIC_ONLY==='true'
    ?diagnoseCityData(process.env.AMAP_WEB_SERVICE_KEY||'',process.env.CITY_UPDATE_CITY||'北京市')
    :runCityUpdate()).catch(error=>{console.error(String(error.message||'城市更新失败。'));process.exitCode=1;});
}
