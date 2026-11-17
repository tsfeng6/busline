import {useEffect,useState} from 'react';
import {CITY_DETAIL_ZOOM,validCityOverview,type CityOverview} from '../utils/cityOverview';
/** Geographic image layers: no markers, cards, labels, click targets or position offsets. */
export function CityOverviewLayer({map,zoom,enabled}:{map:any;zoom:number;enabled:boolean}){
  const [cities,setCities]=useState<CityOverview[]|null>(null);
  useEffect(()=>{
    if(!map||!enabled||zoom>=CITY_DETAIL_ZOOM||cities)return;
    const controller=new AbortController();
    fetch(`${import.meta.env.BASE_URL}city-data/v1/overview.json?v=geographic-v3`,{signal:controller.signal,cache:'no-cache'})
      .then(r=>{if(!r.ok)throw Error('overview unavailable');return r.json();})
      .then(data=>{if(data.schemaVersion!==2||!Array.isArray(data.cities))throw Error('invalid geographic overview');setCities(data.cities.filter(validCityOverview));})
      .catch(()=>{/* An overview failure never blocks precise city reads or manual search. */});
    return()=>controller.abort();
  },[map,enabled,zoom,cities]);
  useEffect(()=>{
    if(!map||!enabled||zoom>=CITY_DETAIL_ZOOM||!cities)return;
    const AMap=(window as any).AMap;if(!AMap?.ImageLayer)return;
    const layers=new Map<string,any>();
    const update=()=>{
      const viewport=map.getBounds(),sw=viewport.getSouthWest(),ne=viewport.getNorthEast();
      for(const city of cities){
        const [west,south,east,north]=city.bounds;
        const visible=east>=sw.lng&&west<=ne.lng&&north>=sw.lat&&south<=ne.lat;
        if(!visible){const old=layers.get(city.city);if(old){map.remove(old);layers.delete(city.city);}continue;}
        if(layers.has(city.city))continue;
        const layer=new AMap.ImageLayer({url:`${import.meta.env.BASE_URL}city-data/v1/${city.thumbnail}`,
          bounds:new AMap.Bounds([west,south],[east,north]),zooms:[2,CITY_DETAIL_ZOOM],opacity:.95,zIndex:20});
        map.add(layer);layers.set(city.city,layer);
      }
    };
    update();map.on('moveend',update);
    return()=>{map.off('moveend',update);for(const layer of layers.values())map.remove(layer);};
  },[map,enabled,zoom<CITY_DETAIL_ZOOM,cities]);
  return null;
}
