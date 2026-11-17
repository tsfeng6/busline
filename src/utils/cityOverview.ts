export const CITY_DETAIL_ZOOM = 11;
export type CityOverview = {city:string;center:[number,number];bounds:[number,number,number,number];lineDirections:number;capturedAt:string;thumbnail:string};
/** Display-only rasterization. Source coordinates are read, never rounded or rewritten. */
export function cityThumbnail(data:{city:string;capturedAt:string;lines:{path:[number,number][]}[]}) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const line of data.lines||[])for(const [x,y] of line.path||[]){if(!Number.isFinite(x)||!Number.isFinite(y))continue;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  if(!Number.isFinite(minX))return null;
  const W=160,H=100,grid=new Uint8Array(W*H),scale=Math.min((W-12)/Math.max(maxX-minX,1e-6),(H-12)/Math.max(maxY-minY,1e-6));
  const ox=(W-(maxX-minX)*scale)/2,oy=(H-(maxY-minY)*scale)/2;
  for(const line of data.lines||[]){let previous:[number,number]|null=null;
    for(const [x,y] of line.path||[]){if(!Number.isFinite(x)||!Number.isFinite(y)){previous=null;continue;}
      const point:[number,number]=[Math.round(ox+(x-minX)*scale),Math.round(oy+(maxY-y)*scale)];
      if(previous){const steps=Math.max(Math.abs(point[0]-previous[0]),Math.abs(point[1]-previous[1]));
        for(let i=0;i<=steps;i++){const t=steps?i/steps:0,px=Math.round(previous[0]+(point[0]-previous[0])*t),py=Math.round(previous[1]+(point[1]-previous[1])*t);if(px>=0&&px<W&&py>=0&&py<H)grid[py*W+px]=1;}
      }previous=point;
    }
  }
  let d='';for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!grid[y*W+x])continue;const start=x;while(x+1<W&&grid[y*W+x+1])x++;d+=`M${start} ${y}h${x-start+1}`;}
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><rect width="160" height="100" rx="12" fill="#f2f6f3"/><path d="${d}" fill="none" stroke="#52796f" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  return {svg,meta:{city:data.city,center:[(minX+maxX)/2,(minY+maxY)/2] as [number,number],bounds:[minX,minY,maxX,maxY] as [number,number,number,number],lineDirections:data.lines.length,capturedAt:data.capturedAt}};
}
