import { districtSearchScopes } from '../src/utils/searchCity';

/** POI search is capped at 200 records per query. Split saturated areas instead of paging past that cap. */
type Box={west:number;south:number;east:number;north:number;depth:number};
type Area={code:string;box:Box|null};
type RequestPOI=(path:string,params:Record<string,string>)=>Promise<any>;
export async function discoverCityStops(district:any,request:RequestPOI,maxRequests=400,onProgress?:(message:string)=>Promise<void>){
  const scope=String(district.adcode||district.name),pois=new Map<string,any>(),issues:string[]=[];
  let requests=0,complete=true;
  const points=typeof district.polyline==='string'?district.polyline.split(/[|;]/).map((s:string)=>s.split(',').map(Number)).filter((p:number[])=>p.length===2&&p.every(Number.isFinite)):[];
  const root:Box|null=points.length>=3?{west:Math.min(...points.map((p:number[])=>p[0])),east:Math.max(...points.map((p:number[])=>p[0])),south:Math.min(...points.map((p:number[])=>p[1])),north:Math.max(...points.map((p:number[])=>p[1])),depth:0}:null;
  const prefix=district.level==='district'?scope:scope.endsWith('0000')?scope.slice(0,2):scope.slice(0,4);
  const belongs=(poi:any)=> typeof poi.adcode==='string'&&poi.adcode ? poi.adcode.startsWith(prefix)
    : typeof poi.cityname==='string'&&poi.cityname ? poi.cityname.replace(/市$/,'')===String(district.name).replace(/市$/,'') : true;
  const ingest = (items: any[], code: string) => {
    for (const poi of items) {
      if (!belongs(poi)) continue;
      const id = poi.id || `${poi.name}:${poi.location}`;
      const previous = pois.get(id);
      const address = [...new Set([previous?.address, poi.address].flatMap(value =>
        typeof value === 'string' ? value.split(/[;；]/).map(name => name.trim()).filter(Boolean) : []))].join(';');
      const searchScope = /^\d{6}$/.test(poi.adcode) ? String(poi.adcode) : previous?.searchScope || code;
      pois.set(id, { ...poi, address, searchScope });
    }
  };
  const childCodes = districtSearchScopes(Array.isArray(district.districts) ? district.districts : [])
    .filter(code => code !== scope);
  const queue: Area[] = [...childCodes, scope].map(code => ({ code, box: null }));
  let queuedRoot = false;
  const split=(box:Box)=>{
    if(box.depth>=12||Math.max(box.east-box.west,box.north-box.south)<0.002){complete=false;issues.push('站点密集区域达到最小分区，仍可能截断。');return;}
    const x=(box.west+box.east)/2,y=(box.south+box.north)/2;
    for(const [w,s,e,n] of [[box.west,box.south,x,y],[x,box.south,box.east,y],[box.west,y,x,box.north],[x,y,box.east,box.north]])queue.push({code:scope,box:{west:w,south:s,east:e,north:n,depth:box.depth+1}});
  };
  while(queue.length){
    const {box,code}=queue.shift()!;
    // Bound query dimensions as well as record counts; large rural cities remain affordable.
    if(box&&Math.max(box.east-box.west,box.north-box.south)>0.5){split(box);continue;}
    let seen=new Set<string>(),received=0,total=Infinity,subdivide=false;
    for(let page=1;page<=8;page++){
      if(requests>=maxRequests){complete=false;issues.push('站点发现达到本次请求预算，尚有区域未完成。');return{pois:[...pois.values()],complete,requests,issues};}
      requests++;
      const params:Record<string,string>={types:'150700',keywords:'',offset:'25',page:String(page),extensions:'all'};
      if(box)params.polygon=`${box.west.toFixed(6)},${box.north.toFixed(6)}|${box.east.toFixed(6)},${box.south.toFixed(6)}`;
      else{params.city=code;params.citylimit='true';}
      const response=await request(box?'/v3/place/polygon':'/v3/place/text',params);
      const items=Array.isArray(response.pois)?response.pois:[];
      const count=Number(response.count);if(Number.isFinite(count)&&count>=0)total=count;
      const signature=items.map((p:any)=>p.id||`${p.name}:${p.location}`).join('|');
      if(items.length&&seen.has(signature)){subdivide=true;break;}
      seen.add(signature);received+=items.length;ingest(items,code);
      if(Number.isFinite(total)&&total>=200){subdivide=true;break;}
      if(!items.length){if(Number.isFinite(total)&&received<total)subdivide=true;break;}
      if(received>=total||!Number.isFinite(total)&&items.length<25)break;
      if(page===8)subdivide=true;
    }
    if(subdivide){
      if(box)split(box);
      else if(root && !queuedRoot){queue.push({code:scope,box:root});queuedRoot=true;}
      else if(!root){complete=false;issues.push('搜索结果截断且未取得行政边界，无法继续分区。');}
    }
    if(requests%20===0)await onProgress?.(`正在分区发现站点：已查询 ${requests} 次，待处理 ${queue.length} 个区域。`);
  }
  return{pois:[...pois.values()],complete,requests,issues};
}
