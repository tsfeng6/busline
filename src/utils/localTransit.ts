import type {CityDataset} from './cityDataset';
import type {BusLine} from '../types';
import {PROVINCE_CITIES} from '../data/provinceCities';
export type Point=[number,number];
export type CountySeat={name:string;city:string;center:Point;source:'government-stop'};
export type PublishedCity={city:string;province:string;center:Point;bounds:[number,number,number,number];countySeats:CountySeat[];lineDirections:number;capturedAt:string};
const canonical=(name:string)=>name.replace(/市$/,'');
export const routeName=(name:string)=>name.replace(/[（(].*$/,'').replace(/#\d+$/,'').trim();
export function provinceForCity(city:string){return Object.entries(PROVINCE_CITIES).find(([,cities])=>cities.some(name=>canonical(name)===canonical(city)))?.[0]||'';}
export function regularGameRoute(name:string){
 const label=routeName(name);
 // Games intentionally use familiar, ordinary bus services only.  Keep this
 // conservative: a label that is not a simple public route number is not a
 // useful ladder question, even when it happens to have a numeric suffix.
 if(/专线|节假日|假日|节日|机场|巴士|地铁|铁路|市郊|旅游|定制|通勤|商务|摆渡|校车|高铁|快直|夜班|夜[0-9]|社区|微循环|园区|区间快/.test(label))return false;
 return /^(?:[A-Za-z]{1,3}|[\u4e00-\u9fff]{1,3})?\d{1,4}(?:路)?(?:快车?|慢|支|区间|内环|外环)?(?:路)?$/.test(label);
}
export function eligibleGameLines(lines:BusLine[],difficulty:string){
 const found=new Map<string,BusLine>();
 for(const line of lines)if(line.path?.length>1&&regularGameRoute(line.name)&&!found.has(routeName(line.name)))found.set(routeName(line.name),line);
 return [...found.values()];
}
export function savedCountySeats(data:CityDataset):CountySeat[]{
 const seats=new Map<string,CountySeat>();
 for(const stop of [...data.stops,...data.lines.flatMap(line=>line.via_stops||[])]){
  let name=stop.name.match(/([\u4e00-\u9fff]{1,12}(?:县|区|旗|市))(?:人民)?政府/)?.[1];
  const province=provinceForCity(data.city);
  if(province&&name?.startsWith(province)&&name!==province)name=name.slice(province.length);
  const prefix=canonical(data.city);
  if(name?.startsWith(prefix)&&canonical(name)!==prefix)name=name.slice(prefix.length).replace(/^市/,'');
  if(!name||/开发区|高新区|经开区|工业园|产业园/.test(name)||/^(地区|新区|自治县|自治旗|自治区|自治州|市辖区|行政区)$/.test(name)||provinceForCity(name))continue; // Named prefecture governments are not county seats.
  if(!seats.has(name))seats.set(name,{name,city:data.city,center:[stop.location.lng,stop.location.lat],source:'government-stop'});
 }
 return [...seats.values()];
}
const EARTH=6371008.8,DEG=Math.PI/180;
function metric(point:Point,center:Point):Point{return [(point[0]-center[0])*DEG*EARTH*Math.cos(center[1]*DEG),(point[1]-center[1])*DEG*EARTH];}
export function distanceMeters(a:Point,b:Point){const [x,y]=metric(a,b);return Math.hypot(x,y);}
export function routeDistance(path:Point[],center:Point){
 let best=Infinity;const sx=DEG*EARTH*Math.cos(center[1]*DEG),sy=DEG*EARTH;
 for(let i=1;i<path.length;i++){
  const ax=(path[i-1][0]-center[0])*sx,ay=(path[i-1][1]-center[1])*sy,bx=(path[i][0]-center[0])*sx,by=(path[i][1]-center[1])*sy,dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));
 }
 return best;
}
/** Retain only the actual segment intersections with the county's circular window. */
export function clipRouteToRadius(path:Point[],center:Point,radius:number):Point[][]{
 const paths:Point[][]=[];let current:Point[]=[];
 for(let i=1;i<path.length;i++){
  const first=path[i-1],last=path[i],a=metric(first,center),b=metric(last,center),dx=b[0]-a[0],dy=b[1]-a[1],A=dx*dx+dy*dy;
  if(!A)continue;
  const B=2*(a[0]*dx+a[1]*dy),C=a[0]*a[0]+a[1]*a[1]-radius*radius,D=B*B-4*A*C;
  if(D<0){if(current.length>1)paths.push(current);current=[];continue;}
  const lo=Math.max(0,(-B-Math.sqrt(D))/(2*A)),hi=Math.min(1,(-B+Math.sqrt(D))/(2*A));
  if(lo>hi){if(current.length>1)paths.push(current);current=[];continue;}
  const point=(t:number):Point=>t===0?first:t===1?last:[first[0]+(last[0]-first[0])*t,first[1]+(last[1]-first[1])*t];
  const start=point(lo),end=point(hi),tail=current.at(-1);
  if(tail&&(Math.abs(tail[0]-start[0])>1e-9||Math.abs(tail[1]-start[1])>1e-9)){if(current.length>1)paths.push(current);current=[];}
  if(!current.length)current.push(start);current.push(end);
  if(hi<1){if(current.length>1)paths.push(current);current=[];}
 }
 if(current.length>1)paths.push(current);return paths;
}
export function radiusRing(center:Point,radius:number):Point[]{
 return Array.from({length:97},(_,i)=>{const angle=i/96*Math.PI*2;return [center[0]+Math.cos(angle)*radius/(DEG*EARTH*Math.cos(center[1]*DEG)),center[1]+Math.sin(angle)*radius/(DEG*EARTH)] as Point;});
}
export function nearbyLines(data:CityDataset,position:Point,radius=500){
 const found=new Map<string,{city:string;line:BusLine;distance:number}>();
 for(const line of data.lines){const distance=routeDistance(line.path,position);if(distance>radius)continue;
  const key=routeName(line.name),previous=found.get(key);if(!previous||distance<previous.distance)found.set(key,{city:data.city,line,distance});}
 return [...found.values()].sort((a,b)=>a.distance-b.distance);
}
export function cityTouchesRadius(city:PublishedCity,position:Point,radius:number){
 const closest:Point=[Math.max(city.bounds[0],Math.min(city.bounds[2],position[0])),Math.max(city.bounds[1],Math.min(city.bounds[3],position[1]))];
 return distanceMeters(closest,position)<=radius;
}
/** Local WGS84 -> GCJ-02 conversion: browser GPS is not already in the map's coordinate system. */
export function gpsToMap([lng,lat]:Point):Point{
 if(lng<72.004||lng>137.8347||lat<.8293||lat>55.8271)return [lng,lat];
 const x=lng-105,y=lat-35,pi=Math.PI;
 let dLat=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
 dLat+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
 dLat+=(20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3;
 dLat+=(160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3;
 let dLng=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
 dLng+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
 dLng+=(20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3;
 dLng+=(150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3;
 const rad=lat/180*pi,sin=Math.sin(rad),magic=1-.00669342162296594323*sin*sin,sqrt=Math.sqrt(magic);
 dLat=dLat*180/((6378245*(1-.00669342162296594323))/(magic*sqrt)*pi);
 dLng=dLng*180/(6378245/sqrt*Math.cos(rad)*pi);return [lng+dLng,lat+dLat];
}
export const DAILY_LOCATION_KEY='app_daily_location_attempt';
export function claimDailyLocation(storage:Pick<Storage,'getItem'|'setItem'>,date=new Date()){
 const day=`${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
 try{if(storage.getItem(DAILY_LOCATION_KEY)===day)return false;storage.setItem(DAILY_LOCATION_KEY,day);}catch{/* The caller also guards the current page in memory. */}
 return true;
}
