import type {BusLine} from '../types';
import type {CityDataset} from './cityDataset';
import {clipRouteToRadius,distanceMeters,eligibleGameLines,regularGameRoute,routeName,type CountySeat,type Point} from './localTransit';
export const COUNTY_GAME_RADIUS_METERS = 10_000;
export type GameMode='line'|'station'|'city'|'county';
export type GameDifficulty='easy'|'medium'|'hard'|'hell';
export type GameStage={showBasemap:boolean;showStops:boolean;isFillIn:boolean;confusing?:boolean};
export type OfflineQuestion={targetCity:string;correctAnswer:string;promptText:string;options:string[];isFillIn:boolean;
 lineInfos?:BusLine[];networkImage?:string;sourceRevision?:string;networkPaths?:Point[][];contextPaths?:Point[][];networkStops?:{name:string;lngLat:Point}[];targetPoint?:{name:string;lngLat:Point};fallbackCenter?:Point;countyWindow?:{center:Point;radius:number};showBasemap?:boolean;showStops?:boolean};
export function shuffle<T>(array:T[],random= Math.random){const copy=[...array];for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}
const stopName=(name:string)=>name.replace(/[（(].*?[）)]/g,'').replace(/公交站$/,'').trim();
function compact(path:Point[]):Point[]{
 if(path.length<=2)return path;const result:Point[]=[path[0]];let last=path[0];
 for(let i=1;i<path.length-1;i++){const point=path[i];if(Math.floor(point[0]*10000)!==Math.floor(last[0]*10000)||Math.floor(point[1]*10000)!==Math.floor(last[1]*10000)){result.push(point);last=point;}}
 result.push(path[path.length-1]);return result;
}
function choices(answer:string,candidates:string[],random:()=>number){return shuffle([answer,...shuffle([...new Set(candidates)].filter(name=>name!==answer),random).slice(0,3)],random);}
/** Choose only from a local neighbourhood, weighting closer stops more heavily. */
export function nearbyStationChoices(answer:string,nearby:string[],random:()=>number){
 const pool=[...new Set(nearby)].filter(name=>name!==answer).slice(0,12),picked:string[]=[];
 while(pool.length&&picked.length<3){
  const weight=pool.reduce((sum,_,index)=>sum+1/(index+1),0);let cursor=random()*weight,index=0;
  for(;index<pool.length-1;index++){cursor-=1/(index+1);if(cursor<=0)break;}
  picked.push(pool.splice(index,1)[0]);
 }
 return shuffle([answer,...picked],random);
}
function stops(lines:BusLine[]){const found=new Map<string,{name:string;lngLat:Point}>();for(const line of lines)for(const stop of line.via_stops||[])if(stop.location){const key=`${stop.name}:${stop.location.lng},${stop.location.lat}`;found.set(key,{name:stop.name,lngLat:[stop.location.lng,stop.location.lat]});}return [...found.values()];}
function intermediateStops(lines:BusLine[]){
 const found=new Map<string,{name:string;lngLat:Point}>();
 for(const line of lines){const valid=(line.via_stops||[]).filter(stop=>stop.location);for(const stop of valid.slice(1,-1)){const key=`${stop.name}:${stop.location.lng},${stop.location.lat}`;found.set(key,{name:stop.name,lngLat:[stop.location.lng,stop.location.lat]});}}
 return [...found.values()];
}
function routeShape(name:string){const label=routeName(name).replace(/路$/,'');const match=label.match(/^([^\d]*)(\d+)(.*)$/);return {prefix:match?.[1]||'',digits:match?.[2]||'',suffix:match?.[3]||'',label};}
function confusingLineChoices(answer:string,pool:BusLine[],random:()=>number){
 const a=routeShape(answer);const ranked=pool.map(line=>routeName(line.name)).filter(name=>name!==answer).map(name=>{const b=routeShape(name);let score=0;if(a.prefix&&a.prefix===b.prefix)score+=8;if(a.digits.length===b.digits.length)score+=4;if(a.suffix===b.suffix)score+=2;if(a.prefix===b.prefix&&a.digits&&b.digits)score+=2;return {name,score};}).sort((x,y)=>y.score-x.score||x.name.localeCompare(y.name,'zh-CN'));
 const best=ranked.filter(item=>item.score>0).map(item=>item.name);return choices(answer,best.length>=3?best:ranked.map(item=>item.name),random);
}
export function gameStage(mode:GameMode,difficulty:GameDifficulty,number:number):GameStage{
 if(mode!=='line'&&mode!=='station')return {showBasemap:false,showStops:true,isFillIn:number>10};
 const hell=difficulty==='hell';
 // Ranges are inclusive: questions 6–10 still retain the basemap in the
 // standard ladder; only the distractors become deliberately similar.
 return {showBasemap:hell?number<=5:number<=10,showStops:hell?number<=10:number<=20,isFillIn:hell,confusing:!hell&&number>=6};
}
export function createOfflineQuestion(mode:GameMode,difficulty:GameDifficulty,data:CityDataset,candidates:string[],number:number,previous='',county?:CountySeat,random=Math.random):OfflineQuestion{
 if(!data.lines.length)throw Error('该城市暂无可用的已保存线路。');
 if(mode==='line'){
  const pool=eligibleGameLines(data.lines,difficulty),available=pool.filter(line=>routeName(line.name)!==previous);
  const line=shuffle(available.length?available:pool,random)[0];if(!line)throw Error('该城市暂无符合要求的常规线路，请更换城市。');
  const config=gameStage(mode,difficulty,number),answer=routeName(line.name),options=config.confusing?confusingLineChoices(answer,pool,random):choices(answer,pool.map(line=>routeName(line.name)),random);
  return {targetCity:data.city,correctAnswer:answer,promptText:`请根据线路走向猜出线路名称（${data.city}）。`,options,isFillIn:config.isFillIn,lineInfos:[line],networkStops:intermediateStops([line]),showBasemap:config.showBasemap,showStops:config.showStops};
 }
 if(mode==='station'){
  const config=gameStage(mode,difficulty,number),lines=data.lines.filter(line=>regularGameRoute(line.name));
  const groups=new Map<string,{name:string;lngLat:Point;lines:BusLine[]}[]>();
  for(const line of lines)for(const stop of line.via_stops||[]){if(!stop.location)continue;const name=stopName(stop.name);if(!name)continue;
   const point:Point=[stop.location.lng,stop.location.lat],same=groups.get(name)||[];
   let item=same.find(candidate=>distanceMeters(candidate.lngLat,point)<=250);
   if(!item){item={name,lngLat:point,lines:[]};same.push(item);groups.set(name,same);}if(!item.lines.includes(line))item.lines.push(line);
  }
  const all=[...groups.values()].flat(),notPrevious=all.filter(item=>item.name!==previous),available=notPrevious.length?notPrevious:all;
  const rich=available.filter(item=>new Set(item.lines.map(line=>routeName(line.name))).size>=2),chosen=shuffle(rich.length?rich:available,random)[0];
  if(!chosen)throw Error('该城市暂无符合此难度的已保存站点数据，请更换城市或难度。');
  const nearby=all.filter(item=>item.name!==chosen.name).sort((a,b)=>distanceMeters(a.lngLat,chosen.lngLat)-distanceMeters(b.lngLat,chosen.lngLat)).map(item=>item.name);
  const options=config.confusing&&nearby.length?nearbyStationChoices(chosen.name,nearby,random):choices(chosen.name,all.map(item=>item.name),random);
  return {targetCity:data.city,correctAnswer:chosen.name,promptText:`请根据目标站点及经过的公交线路猜站名（${data.city}）。`,options,isFillIn:config.isFillIn,lineInfos:chosen.lines,networkStops:stops(chosen.lines).filter(stop=>distanceMeters(stop.lngLat,chosen.lngLat)>5),targetPoint:{name:chosen.name,lngLat:chosen.lngLat},fallbackCenter:chosen.lngLat,showBasemap:config.showBasemap,showStops:config.showStops};
 }
 if(mode==='county'){
  if(!county)throw Error('该省份暂无已保存的县政府站点定位信息。');
  const radius=COUNTY_GAME_RADIUS_METERS,paths=data.lines.flatMap(line=>clipRouteToRadius(line.path,county.center,radius)).map(compact);
  if(!paths.length)throw Error('此县政府站点周边暂无已保存线网，请重试其他县城。');
  const options=choices(county.name,candidates,random);
  return {targetCity:county.name,correctAnswer:county.name,promptText:`以已保存的县政府站点为近似中心，仅显示周边${radius / 1000}公里线网，请猜县城。`,showBasemap:gameStage(mode,difficulty,number).showBasemap,options,isFillIn:number>10||options.length<2,networkPaths:paths,
   networkStops:stops(data.lines).filter(stop=>distanceMeters(stop.lngLat,county.center)<=radius),fallbackCenter:county.center,countyWindow:{center:county.center,radius}};
 }
 const options=choices(data.city,candidates,random);
 return {targetCity:data.city,correctAnswer:data.city,promptText:'根据网站已有的公交线网，猜一猜这是哪个城市？',showBasemap:gameStage(mode,difficulty,number).showBasemap,options,isFillIn:options.length<2,networkPaths:data.lines.map(line=>compact(line.path)),networkStops:stops(data.lines)};
}
