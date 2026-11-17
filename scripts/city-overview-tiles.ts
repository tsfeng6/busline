import {mercatorY} from '../src/utils/cityOverview';
import {cityOverviewPNG} from './city-overview-png';
export const TILE_MIN_ZOOM=2,TILE_MAX_ZOOM=13,TILE_SIZE=256;
export function worldPixel(point:[number,number],zoom:number):[number,number]{
 const size=TILE_SIZE*2**zoom;return [(point[0]+180)/360*size,(180-mercatorY(point[1]))/360*size];
}
/** Sparse occupied pixels across all cities; each image is encoded and released individually. */
export class CityOverviewTiles{
 private tiles=new Map<string,Set<number>>();
 add(data:{lines?:{path:[number,number][]}[]}){
  for(let z=TILE_MIN_ZOOM;z<=TILE_MAX_ZOOM;z++)for(const line of data.lines||[]){
   let prev:[number,number]|null=null;
   for(const point of line.path||[]){
    if(!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>85){prev=null;continue;}
    const p=worldPixel(point,z).map(Math.floor) as [number,number];
    if(prev&&p[0]===prev[0]&&p[1]===prev[1])continue;
    if(!prev)prev=p;
    if(prev){const count=Math.max(Math.abs(p[0]-prev[0]),Math.abs(p[1]-prev[1]));
     // Invalid world-spanning discontinuities must not produce millions of pixels.
     if(count>256*2**z/2){prev=p;continue;}
     for(let i=0;i<=count;i++){const t=count?i/count:0,x=Math.round(prev[0]+(p[0]-prev[0])*t),y=Math.round(prev[1]+(p[1]-prev[1])*t);
      const tx=Math.floor(x/256),ty=Math.floor(y/256),key=`${z}/${tx}/${ty}`;
      if(tx<0||ty<0||tx>=2**z||ty>=2**z)continue;
      let pixels=this.tiles.get(key);if(!pixels){if(this.tiles.size>=25000)throw Error('City tile publication budget exceeded');pixels=new Set();this.tiles.set(key,pixels);}
      pixels.add((y%256)*256+x%256);
     }
    }prev=p;
   }
  }
 }
 get keys(){return [...this.tiles.keys()].sort();}
 *files(prefix:string){
  for(const [key,occupied] of this.tiles){const pixels=new Uint8Array(256*256);for(const index of occupied)pixels[index]=1;
   yield {path:`${prefix}/${key}.png`,content:cityOverviewPNG({width:256,height:256,pixels})};
  }
 }
}
