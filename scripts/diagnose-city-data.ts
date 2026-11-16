import { writeFile } from 'node:fs/promises';
/** Two fixed, small requests to diagnose permissions/quota without launching a city collection. */
export async function diagnoseCityData(key:string,city='北京市',transport:typeof fetch=fetch){
  if(!key)throw new Error('未配置高德 Web 服务 Key。');
  const results=[];
  for(const [service,path,params] of [
    ['站点搜索','/v3/place/text',{city,citylimit:'true',types:'150700',offset:'1',page:'1'}],
    ['线路搜索','/v3/bus/linename',{city,keywords:'1路',offset:'1',page:'1',extensions:'all'}],
  ] as const){
    const url=new URL('https://restapi.amap.com'+path);
    for(const [name,value] of Object.entries({...params,key,output:'JSON'}))url.searchParams.set(name,value);
    try{
      const response=await transport(url,{signal:AbortSignal.timeout(15000)}),data:any=await response.json();
      results.push({service,http:response.status,status:String(data.status),infocode:String(data.infocode||'').replace(/[^0-9]/g,'').slice(0,8),count:Number(data.count)||0,
        returned:Array.isArray(data.buslines)?data.buslines.length:Array.isArray(data.pois)?data.pois.length:0});
    }catch{results.push({service,error:'请求超时、网络异常或响应格式异常'});}
  }
  await writeFile('city-update-report.json',JSON.stringify({city,diagnostic:true,results},null,2));
  console.log(JSON.stringify({city,diagnostic:true,results}));
  return results;
}
