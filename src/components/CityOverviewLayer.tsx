import {useEffect,useState} from 'react';
import {CITY_DETAIL_ZOOM,type CityOverview} from '../utils/cityOverview';
export function CityOverviewLayer({map,zoom,enabled}:{map:any;zoom:number;enabled:boolean}){
  const [cities,setCities]=useState<CityOverview[]|null>(null);
  useEffect(()=>{
    if(!map||!enabled||zoom>=CITY_DETAIL_ZOOM||cities)return;
    const controller=new AbortController();
    fetch(`${import.meta.env.BASE_URL}city-data/v1/overview.json`,{signal:controller.signal,cache:'no-cache'})
      .then(r=>{if(!r.ok)throw Error('overview unavailable');return r.json();})
      .then(data=>{if(!Array.isArray(data.cities))throw Error('invalid overview');setCities(data.cities.filter((c:any)=>typeof c.city==='string'&&Array.isArray(c.center)&&c.center.length===2&&c.center.every(Number.isFinite)&&/^thumbnails\/[\p{L}\p{N}·% _-]+\.svg$/u.test(c.thumbnail)));})
      .catch(()=>{/* The overview never blocks precise city reads or manual searches. */});
    return()=>controller.abort();
  },[map,enabled,zoom,cities]);
  useEffect(()=>{
    if(!map||!enabled||zoom>=CITY_DETAIL_ZOOM||!cities)return;
    const AMap=(window as any).AMap;if(!AMap)return;
    const markers:any[]=[];
    const update=()=>{
      for(const marker of markers)marker.setMap(null);markers.length=0;
      const bounds=map.getBounds();
      const occupied:{x:number;y:number}[]=[];
      const compact=zoom<7,width=compact?84:112,height=compact?72:92;
      for(const city of cities){
        if(!bounds.contains(new AMap.LngLat(...city.center)))continue;
        const button=document.createElement('button');button.type='button';button.title=`${city.city} · ${city.lineDirections}个线路方向，点击放大`;
        button.setAttribute('aria-label',button.title);
        button.style.cssText='display:flex;flex-direction:column;align-items:center;width:112px;padding:4px;border:1px solid #d6e2da;border-radius:14px;background:#f8faf8;box-shadow:0 3px 12px #243d3226;cursor:pointer;color:#29443b;font:600 12px system-ui;';
        if(compact)button.style.width='84px';
        const image=document.createElement('img');image.src=`${import.meta.env.BASE_URL}city-data/v1/${city.thumbnail}`;image.alt='';image.width=compact?76:104;image.height=compact?48:65;image.style.borderRadius='10px';
        const label=document.createElement('span');label.textContent=city.city;label.style.cssText='padding:3px 0;white-space:nowrap';
        button.append(image,label);button.onclick=(event)=>{event.stopPropagation();map.setZoomAndCenter(12,city.center);};
        const point=map.lngLatToContainer(new AMap.LngLat(...city.center));
        let dx=0,dy=0;
        // Spread neighboring cities into small rows so national-view cards remain clickable.
        outer:for(let ring=0;ring<5;ring++)for(let y=-ring;y<=ring;y++)for(let x=-ring;x<=ring;x++){
          if(ring&&Math.max(Math.abs(x),Math.abs(y))!==ring)continue;
          const cx=point.x+x*(width+6),cy=point.y+y*(height+6);
          if(!occupied.some(p=>Math.abs(p.x-cx)<width+4&&Math.abs(p.y-cy)<height+4)){dx=cx-point.x;dy=cy-point.y;occupied.push({x:cx,y:cy});break outer;}
        }
        const marker=new AMap.Marker({position:city.center,content:button,offset:new AMap.Pixel(dx,dy),anchor:'center',bubble:false,zIndex:60});marker.setMap(map);markers.push(marker);
      }
    };
    update();map.on('moveend',update);
    return()=>{map.off('moveend',update);for(const marker of markers)marker.setMap(null);};
  },[map,enabled,zoom,cities]);
  return null;
}
