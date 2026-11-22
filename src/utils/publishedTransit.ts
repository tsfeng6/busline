import {validCityOverview} from './cityOverview';
import {provinceForCity,type PublishedCity} from './localTransit';
import {cityDataCache} from './spatialLoader';
import type {CityDataset} from './cityDataset';
import {loadSharedCityForGame} from './sharedCityClient';
let catalogTask:Promise<PublishedCity[]>|undefined;
let catalogAt=0,revision='';
export function loadPublishedCities(refresh=false):Promise<PublishedCity[]>{
 if(catalogTask&&catalogAt&&(refresh||Date.now()-catalogAt>60000)){catalogTask=undefined;catalogAt=0;}
 if(!catalogTask)catalogTask=(async()=>{
  const response=await globalThis.fetch(`${import.meta.env.BASE_URL}city-data/v1/overview.json?v=local-games-v1`,{cache:'no-cache',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('暂时无法读取已收录城市，请稍后重试。');
  const data=await response.json();
  if(!Array.isArray(data.cities))throw Error('城市目录格式无效。');
  const nextRevision=String(data.tiles?.revision||'');if(revision&&nextRevision!==revision)cityDataCache.invalidate();revision=nextRevision;catalogAt=Date.now();
  return data.cities.filter(validCityOverview).map((city:any)=>({...city,province:city.province||provinceForCity(city.city),countySeats:Array.isArray(city.countySeats)?city.countySeats.filter((seat:any)=>typeof seat.name==='string'&&seat.source==='government-stop'&&Array.isArray(seat.center)&&seat.center.length===2&&seat.center.every(Number.isFinite)).map((seat:any)=>({...seat,city:city.city})):[]}));
 })().catch(error=>{catalogTask=undefined;throw error;});
 return catalogTask;
}
export async function loadGameCity(city:string,onPart?:(completed:number,total:number)=>void):Promise<CityDataset>{
 const cached=cityDataCache.peek(city);if(cached)return cached;
 try{
  const data=await loadSharedCityForGame(city,onPart);cityDataCache.remember(data);return data;
 }catch(error:any){
  if(error?.status===404)throw Error('该城市的已保存线路暂时不可用，请选择其他城市。');
  throw Error('读取城市线路超时或网络不稳定，请检查网络后重试。',{cause:error});
 }
}
