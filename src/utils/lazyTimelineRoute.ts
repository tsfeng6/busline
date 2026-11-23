/** Timeline visibility and viewport visibility are independent; offscreen geometry stays out of the SDK. */
export function lazyTimelineRoute(map:any, AMap:any, options:any, onClick:(event?: any)=>void) {
  let paths:any[] = [], enabled = true, overlay:any = null;
  const release = () => {
    if (!overlay) return;
    map.remove(overlay); overlay.off?.('click',onClick); overlay.destroy?.(); overlay=null;
  };
  const sync = () => {
    if (!enabled || !paths.some(path=>path.length>1)) { release(); return; }
    if (!overlay) { overlay=new AMap.Polyline({...options,path:paths});overlay.on('click',onClick);map.add(overlay); }
    else overlay.setPath(paths);
  };
  return { setOptions(next:any){options={...options,...next};overlay?.setOptions(next);},show(){enabled=true;sync();},hide(){enabled=false;release();},setPaths(next:any[]){paths=next;sync();},destroy:release };
}
