import { createHmac, createHash } from 'node:crypto';
import { normalizeCityDataset, cityDataKey } from '../src/utils/cityDataset';
export async function readCityUpload(endpoint:URL,id:string,city:string,secret:string,transport:typeof fetch=fetch){
  const read=async(part?:number)=>{
    const at=Date.now(),message=`${id}:${part===undefined?'manifest':part}:${at}`;
    const response=await transport(new URL(`/uploads/${id}${part===undefined?'':`/chunks/${part}`}`,endpoint),{headers:{'x-city-timestamp':String(at),'x-city-signature':createHmac('sha256',secret).update(message).digest('hex')},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('无法读取已上传数据，请重新提交。');
    return response;
  };
  const meta=await(await read()).json() as any;
  if(cityDataKey(meta.city)!==cityDataKey(city)||!Number.isInteger(meta.bytes)||meta.bytes<2||meta.bytes>30*1024*1024||meta.parts!==Math.ceil(meta.bytes/(256*1024))||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('上传数据清单无效。');
  const parts:Buffer[]=[];let size=0;
  for(let index=0;index<meta.parts;index++){
    const part=Buffer.from(await(await read(index)).arrayBuffer());size+=part.length;
    if(size>meta.bytes||part.length>(256*1024))throw Error('上传数据大小异常。');
    parts.push(part);
  }
  const bytes=Buffer.concat(parts);
  if(bytes.length!==meta.bytes||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('上传数据完整性校验失败。');
  const data=normalizeCityDataset(JSON.parse(bytes.toString('utf8')));
  if(cityDataKey(data.city)!==cityDataKey(city)||data.filtered)throw Error('不能将其他城市或已过滤结果发布为全市数据。');
  return data;
}
