import {mercatorY} from '../src/utils/cityOverview';
import {cityOverviewPNG} from './city-overview-png';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
export const TILE_MIN_ZOOM=2,TILE_MAX_ZOOM=13,TILE_SIZE=256,TILE_PIXEL_RATIO=2;
const RASTER_SIZE=TILE_SIZE*TILE_PIXEL_RATIO;
export function worldPixel(point:[number,number],zoom:number):[number,number]{
 const size=TILE_SIZE*2**zoom;return [(point[0]+180)/360*size,(180-mercatorY(point[1]))/360*size];
}
/** One byte per coverage pixel, with optional bounded disk-backed working storage. */
export class CityOverviewTiles{
 private tiles=new Map<string,{pixels:Uint8Array;dirty:boolean}>();
 private tileKeys=new Set<string>();
 constructor(private options:{cacheDirectory?:string;maxResidentTiles?:number}={}){
  if(options.maxResidentTiles!==undefined&&(!Number.isInteger(options.maxResidentTiles)||options.maxResidentTiles<1))throw Error('Invalid resident tile limit');
 }
 get residentBytes(){return this.tiles.size*RASTER_SIZE*RASTER_SIZE;}
 private cachePath(key:string){return join(this.options.cacheDirectory!,`${key}.raw`);}
 private pixels(key:string){
  let tile=this.tiles.get(key);
  if(tile)return tile;
  if(this.options.cacheDirectory&&this.tiles.size>=(this.options.maxResidentTiles??128)){
   const oldest=this.tiles.keys().next().value!;
   const entry=this.tiles.get(oldest)!;
   if(entry.dirty){const path=this.cachePath(oldest);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,entry.pixels);}
   this.tiles.delete(oldest);
  }
  const existed=this.tileKeys.has(key);
  if(!existed&&this.tileKeys.size>=25000)throw Error('City tile publication budget exceeded');
  const pixels=existed?readFileSync(this.cachePath(key)):new Uint8Array(RASTER_SIZE*RASTER_SIZE);
  if(pixels.length!==RASTER_SIZE*RASTER_SIZE)throw Error('Invalid tile working file');
  tile={pixels,dirty:!existed};this.tiles.set(key,tile);this.tileKeys.add(key);return tile;
 }
 private paint(z:number,x:number,y:number,alpha:number){
  if(alpha<=0)return;
  const tx=Math.floor(x/RASTER_SIZE),ty=Math.floor(y/RASTER_SIZE);
  if(tx<0||ty<0||tx>=2**z||ty>=2**z)return;
  const key=`${z}/${tx}/${ty}`;
  const tile=this.pixels(key),pixels=tile.pixels;
  const index=(y%RASTER_SIZE)*RASTER_SIZE+x%RASTER_SIZE;
  // Repeated routes cannot darken or thicken the same edge.
  if(alpha>pixels[index]){pixels[index]=alpha;tile.dirty=true;}
 }
 add(data:{lines?:{path:[number,number][]}[]}){
  for(let z=TILE_MIN_ZOOM;z<=TILE_MAX_ZOOM;z++)for(const line of data.lines||[]){
   let prev:[number,number]|null=null;
   for(const point of line.path||[]){
    if(!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>85){prev=null;continue;}
    const p=worldPixel(point,z).map(v=>v*TILE_PIXEL_RATIO) as [number,number];
    if(prev&&p[0]===prev[0]&&p[1]===prev[1])continue;
    const a=prev||p,dx=p[0]-a[0],dy=p[1]-a[1],major=Math.max(Math.abs(dx),Math.abs(dy));
    if(major>RASTER_SIZE*2**z/2){prev=p;continue;}
    // Wu-style subpixel coverage at 512px, with a roughly one-CSS-pixel stroke.
    const steep=Math.abs(dy)>Math.abs(dx),count=Math.max(1,Math.ceil(major));
    for(let i=0;i<=count;i++){
     const t=i/count,x=a[0]+dx*t,y=a[1]+dy*t;
     const primary=Math.round(steep?y:x),secondary=steep?x:y,base=Math.floor(secondary);
     for(let offset=-1;offset<=2;offset++){
      const side=base+offset,alpha=Math.round(Math.max(0,Math.min(1,1.5-Math.abs(side-secondary)))*255);
      this.paint(z,steep?side:primary,steep?primary:side,alpha);
     }
    }
    prev=p;
   }
  }
 }
 get keys(){return [...this.tileKeys].sort();}
 *files(prefix:string){
  for(const key of this.tileKeys){const pixels=this.tiles.get(key)?.pixels??readFileSync(this.cachePath(key));
   yield {path:`${prefix}/${key}.png`,content:cityOverviewPNG({width:RASTER_SIZE,height:RASTER_SIZE,pixels,alpha:true})};
  }
 }
}
