import {useEffect,useState} from 'react';
import {CITY_DETAIL_ZOOM,validTileIndex,type OverviewTileIndex} from '../utils/cityOverview';
const EMPTY_TILE='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Native XYZ tile selection: no stretching a single city image across zoom levels. */
export function CityOverviewLayer({map,zoom,enabled,detailReady=false}:{map:any;zoom:number;enabled:boolean;detailReady?:boolean}){
 const [index,setIndex]=useState<OverviewTileIndex|null>(null);
 const overviewVisible=enabled&&(zoom<CITY_DETAIL_ZOOM||(!detailReady&&zoom<=CITY_DETAIL_ZOOM));
 useEffect(()=>{
  if(!map||!enabled)return;
  const controller=new AbortController();
  fetch(`${import.meta.env.BASE_URL}city-data/v1/overview.json?v=xyz-v1`,{signal:controller.signal,cache:'no-cache'})
   .then(r=>{if(!r.ok)throw Error('Overview unavailable');return r.json();})
   .then(data=>{if(data.schemaVersion!==3||!validTileIndex(data.tiles))throw Error('Invalid tile index');setIndex(data.tiles);})
   .catch(()=>{/* Precise data and manual search remain independent. */});
  return()=>controller.abort();
 },[map,enabled,zoom<CITY_DETAIL_ZOOM]);
 useEffect(()=>{
  if(!map||!overviewVisible||!index)return;
  const AMap=(window as any).AMap;if(!AMap?.TileLayer)return;
  const keys=new Set(index.keys);
  const layer=new AMap.TileLayer({getTileUrl:(x:number,y:number,z:number)=>{
   const key=`${z}/${x}/${y}`;return keys.has(key)?`${import.meta.env.BASE_URL}city-data/v1/${index.base}/${key}.png?v=${index.revision}`:EMPTY_TILE;
  },zooms:[index.minZoom,index.maxZoom],zIndex:20,opacity:.95});
  map.add(layer);return()=>map.remove(layer);
 },[map,overviewVisible,index]);
 return null;
}
