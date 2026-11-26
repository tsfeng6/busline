import { provinceForCity, type PublishedCity } from './localTransit';
export const CITY_DETAIL_ZOOM = 13;
const DEFAULT_DETAIL_STROKE_PX = 3.75;
const DISTANT_OVERVIEW_STROKE_PX = .875;

/** Keep dense regional views readable and match the detailed layer at handoff. */
export function overviewStrokeWidth(zoom: number): number {
  const transition = Math.max(0, Math.min(1, (zoom - 10) / (CITY_DETAIL_ZOOM - 10)));
  return DISTANT_OVERVIEW_STROKE_PX + transition * (DEFAULT_DETAIL_STROKE_PX - DISTANT_OVERVIEW_STROKE_PX);
}

export function transitStrokeWidth(zoom: number, maxZoom: number, thick: boolean): number {
  const base = thick ? DEFAULT_DETAIL_STROKE_PX : 1.65;
  const finalZoomProgress = Math.max(0, Math.min(1, zoom - maxZoom + 1));
  return base + finalZoomProgress * (thick ? 1.25 : 0.75);
}
/** A larger source image keeps small city-network previews sharp on retina screens. */
export const CITY_THUMBNAIL_MAX_EDGE = 1024;
export const CITY_THUMBNAIL_STROKE_PX = 3;
export type CityOverview = {province?:string;countySeats?:import('./localTransit').CountySeat[];city:string;center:[number,number];bounds:[number,number,number,number];lineDirections:number;capturedAt:string;thumbnail:string};
export const mercatorY=(latitude:number)=>180/Math.PI*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,latitude))*Math.PI/360));
/** Pixels map directly to the image's geographic bounds, with no card padding or fitting offsets. */
export function overviewPixel(point:[number,number],bounds:CityOverview['bounds'],width:number,height:number):[number,number]{
  return [(point[0]-bounds[0])/(bounds[2]-bounds[0])*(width-1),
    (mercatorY(bounds[3])-mercatorY(point[1]))/(mercatorY(bounds[3])-mercatorY(bounds[1]))*(height-1)];
}
export function validCityOverview(c:any):c is CityOverview{
  return typeof c?.city==='string'&&Array.isArray(c.bounds)&&c.bounds.length===4&&c.bounds.every(Number.isFinite)
    &&c.bounds[0]>=-180&&c.bounds[2]<=180&&c.bounds[1]>=-85&&c.bounds[3]<=85&&c.bounds[0]<c.bounds[2]&&c.bounds[1]<c.bounds[3]
    &&/^thumbnails\/[\p{L}\p{N}·% _-]+\.(?:svg|png)$/u.test(c.thumbnail);
}
/** Display-only rasterization. Source coordinates are read, never rounded or rewritten. */
export function cityThumbnail(data:{city:string;capturedAt:string;lines:{path:[number,number][]}[]}) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const line of data.lines||[])for(const [x,y] of line.path||[]){if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(y)>85)continue;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  if(!Number.isFinite(minX))return null;
  if(maxX===minX){minX-=.00001;maxX+=.00001;}if(maxY===minY){minY-=.00001;maxY+=.00001;}
  const bounds:[number,number,number,number]=[minX,minY,maxX,maxY];
  const ratio=(maxX-minX)/(mercatorY(maxY)-mercatorY(minY));
  const W=ratio>=1?CITY_THUMBNAIL_MAX_EDGE:Math.max(32,Math.round(CITY_THUMBNAIL_MAX_EDGE*ratio)),H=ratio>=1?Math.max(32,Math.round(CITY_THUMBNAIL_MAX_EDGE/ratio)):CITY_THUMBNAIL_MAX_EDGE;
  const grid=new Uint8Array(W*H);
  const paint=(x:number,y:number)=>{
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
      const px=x+ox,py=y+oy;if(px>=0&&px<W&&py>=0&&py<H)grid[py*W+px]=255;
    }
  };
  for(const line of data.lines||[]){let previous:[number,number]|null=null;
    for(const [x,y] of line.path||[]){if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(y)>85){previous=null;continue;}
      const pixel=overviewPixel([x,y],bounds,W,H);const point:[number,number]=[Math.round(pixel[0]),Math.round(pixel[1])];
      if(previous){const steps=Math.max(Math.abs(point[0]-previous[0]),Math.abs(point[1]-previous[1]));
        for(let i=0;i<=steps;i++){const t=steps?i/steps:0,px=Math.round(previous[0]+(point[0]-previous[0])*t),py=Math.round(previous[1]+(point[1]-previous[1])*t);paint(px,py);}
      }previous=point;
    }
  }
  let d='';for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!grid[y*W+x])continue;const start=x;while(x+1<W&&grid[y*W+x+1])x++;d+=`M${start} ${y}h${Math.max(.5,x-start)}`;}
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W-1} ${H-1}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#52796f" stroke-width="${CITY_THUMBNAIL_STROKE_PX}" stroke-linecap="round"/></svg>`;
  return {svg,raster:{width:W,height:H,pixels:grid},meta:{city:data.city,center:[(minX+maxX)/2,(minY+maxY)/2] as [number,number],bounds,lineDirections:data.lines.length,capturedAt:data.capturedAt}};
}

export type OverviewTileIndex={base:string;revision:string;minZoom:number;maxZoom:number;keys:string[]};
export function validTileIndex(value:any):value is OverviewTileIndex{
 return value?.base==='tiles/xyz-v1'&&/^[a-f0-9]{40}$/.test(value?.revision||'')&&value.minZoom===2&&value.maxZoom===13&&Array.isArray(value.keys)&&value.keys.length<=100000&&value.keys.every((key:any)=>{
  if(typeof key!=='string'||!/^\d+\/\d+\/\d+$/.test(key))return false;
  const [z,x,y]=key.split('/').map(Number);return z>=2&&z<=13&&x>=0&&y>=0&&x<2**z&&y<2**z;
 });
}

export function normalizeQuizCatalog(input: unknown[]): PublishedCity[] {
 return input.filter(validCityOverview).map(city=>({...city,
  province:city.province||provinceForCity(city.city),
  countySeats:(Array.isArray(city.countySeats)?city.countySeats:[]).filter(seat=>typeof seat.name==='string'&&seat.source==='government-stop'&&Array.isArray(seat.center)&&seat.center.length===2&&seat.center.every(Number.isFinite)).map(seat=>({...seat,city:city.city})),
 }));
}
