import {mercatorY} from '../src/utils/cityOverview';
import {cityOverviewPNG} from './city-overview-png';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {dirname,join} from 'node:path';
export const TILE_MIN_ZOOM=2,TILE_MAX_ZOOM=13,TILE_SIZE=256,TILE_PIXEL_RATIO=3;
/** Route width is specified in CSS pixels, then converted to the raster scale. */
export const OVERVIEW_STROKE_CSS_PX=1.5;
export const OVERVIEW_RASTER_SIZE=TILE_SIZE*TILE_PIXEL_RATIO;
const RASTER_SIZE=OVERVIEW_RASTER_SIZE;
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
  if(!existed&&this.tileKeys.size>=100000)throw Error('City tile publication budget exceeded');
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
  const index=(((y%RASTER_SIZE)+RASTER_SIZE)%RASTER_SIZE)*RASTER_SIZE+((x%RASTER_SIZE)+RASTER_SIZE)%RASTER_SIZE;
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
    // Coverage is scaled from a CSS-pixel width, so changing raster density or
    // map zoom affects sharpness, not the visual line weight.
    const steep=Math.abs(dy)>Math.abs(dx),count=Math.max(1,Math.ceil(major));
    const radius=OVERVIEW_STROKE_CSS_PX*TILE_PIXEL_RATIO/2;
    const support=Math.ceil(radius+.5);
    for(let i=0;i<=count;i++){
     const t=i/count,x=a[0]+dx*t,y=a[1]+dy*t;
     const primary=Math.round(steep?y:x),secondary=steep?x:y,base=Math.floor(secondary);
     for(let offset=-support;offset<=support;offset++){
      const side=base+offset,alpha=Math.round(Math.max(0,Math.min(1,radius+.5-Math.abs(side-secondary)))*255);
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
 /** Raw coverage for a single tile (resident or disk-backed). */
 rawPixels(key:string){return this.tiles.get(key)?.pixels??readFileSync(this.cachePath(key));}
 private mergeTile(key:string,source:Uint8Array){
  const entry=this.pixels(key),target=entry.pixels;let changed=false;
  for(let i=0;i<source.length;i++)if(source[i]>target[i]){target[i]=source[i];changed=true;}
  if(changed)entry.dirty=true;
 }
 /** Max-merge another (disk-backed) layer into this instance, tile by tile. */
 mergeLayer(other:CityOverviewTiles){for(const key of other.keys)this.mergeTile(key,other.rawPixels(key));}
 /** Serialize this layer's coverage to gzip: 4-byte tile count, then per tile [keyLen][key][raw pixels]. */
 serializeLayer():Buffer{
  const keys=this.keys,parts:Buffer[]=[Buffer.alloc(4)];parts[0].writeUInt32BE(keys.length,0);
  for(const key of keys){const keyBuf=Buffer.from(key,'utf8'),len=Buffer.alloc(4);len.writeUInt32BE(keyBuf.length,0);parts.push(len,keyBuf,Buffer.from(this.rawPixels(key)));}
  return gzipSync(Buffer.concat(parts));
 }
 /** Merge a serialized layer (cached gzip) into this instance. */
 mergeSerializedLayer(buffer:Buffer){
  const raw=gunzipSync(buffer);let offset=0;const count=raw.readUInt32BE(offset);offset+=4;
  for(let i=0;i<count;i++){const keyLen=raw.readUInt32BE(offset);offset+=4;
   const key=raw.subarray(offset,offset+keyLen).toString('utf8');offset+=keyLen;
   const source=raw.subarray(offset,offset+RASTER_SIZE*RASTER_SIZE);offset+=RASTER_SIZE*RASTER_SIZE;
   this.mergeTile(key,source);}
 }
}
