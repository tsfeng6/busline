import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { MAX_CITY_BYTES, CITY_CHUNK_BYTES, CITY_UPLOAD_FORMAT, CITY_RECORD_FORMAT } from '../src/utils/cityTransfer';
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
  if(cityDataKey(meta.city)!==cityDataKey(city)||!Number.isInteger(meta.bytes)||meta.bytes<2||meta.bytes>MAX_CITY_BYTES||meta.parts!==Math.ceil(meta.bytes/CITY_CHUNK_BYTES)||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('上传数据清单无效。');
  const compressed=meta.format===CITY_UPLOAD_FORMAT;
  const records = compressed || meta.format === CITY_RECORD_FORMAT;
  if(meta.format && meta.format !== 'json' && !records) throw Error('上传格式无效。');
  const parts:Buffer[]=[];let size=0, pending='';
  const hash=createHash('sha256'), decoder=new TextDecoder();
  let dataset:any=null;
  const consume=(record:string)=>{
    if(!record)return;
    const item=JSON.parse(record);
    if(item.header){if(dataset)throw Error('快照头重复。');dataset={...item.header,lines:[],stops:[]};}
    else if(!dataset)throw Error('缺少快照头。');
    else if(item.line)dataset.lines.push(item.line);
    else if(item.stop)dataset.stops.push(item.stop);
    else throw Error('无效快照记录。');
  };
  async function* download(){
  for(let index=0;index<meta.parts;index++){
    const part=Buffer.from(await(await read(index)).arrayBuffer());size+=part.length;
    if(size>meta.bytes||part.length!==(index===meta.parts-1?meta.bytes-index*CITY_CHUNK_BYTES:CITY_CHUNK_BYTES))throw Error('上传数据大小异常。');
    hash.update(records?createHash('sha256').update(part).digest():part);
    yield part;
  }
  }
  let expandedBytes=0;
  const source=Readable.from(download()),inflate=createGunzip();
  if(compressed)source.on('error',error=>inflate.destroy(error));
  const stream=compressed?source.pipe(inflate):source;
  try { for await(const part of stream){
    expandedBytes+=part.length;if(expandedBytes>MAX_CITY_BYTES)throw Error('解压数据超过1GB。');
    if(records){
      pending+=decoder.decode(part,{stream:true});
      let end:number;while((end=pending.indexOf('\n'))>=0){consume(pending.slice(0,end));pending=pending.slice(end+1);}
      if(pending.length>16*1024*1024)throw Error('单条线路数据过大。');
    }else parts.push(part);
  }
  } finally { source.destroy();inflate.destroy(); }
  if(size!==meta.bytes||hash.digest('hex')!==meta.sha256)throw Error('上传数据完整性校验失败。');
  if(records){pending+=decoder.decode();if(pending)consume(pending);}
  const data=normalizeCityDataset(records?dataset:JSON.parse(Buffer.concat(parts).toString('utf8')));
  if(cityDataKey(data.city)!==cityDataKey(city)||data.filtered)throw Error('不能将其他城市或已过滤结果发布为全市数据。');
  return data;
}
