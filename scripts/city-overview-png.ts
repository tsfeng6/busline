import {deflateSync} from 'node:zlib';
function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const tag=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([head,tag,data,tail]);}
/** Transparent RGBA PNG; all pixels outside the observed network remain fully transparent. */
export function cityOverviewPNG({width,height,pixels}:{width:number;height:number;pixels:Uint8Array}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc(height*(1+width*4));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(!pixels[y*width+x])continue;const at=y*(width*4+1)+1+x*4;rows[at]=0x52;rows[at+1]=0x79;rows[at+2]=0x6f;rows[at+3]=255;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
