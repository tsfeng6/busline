import { useEffect, useState } from 'react';
import type { RankedPuzzle } from '../utils/rankedGame';

export function RankedGameDrawing({ drawing }: { drawing: RankedPuzzle['drawing'] }) {
  const [route, setRoute] = useState(0);
  const routeCount = drawing.frames?.length ?? 0;
  useEffect(() => {
    if (routeCount <= 1) return;
    const timer = window.setInterval(() => setRoute(index => (index + 1) % routeCount), 1000);
    return () => window.clearInterval(timer);
  }, [routeCount]);
  const frame = drawing.frames?.[route] ?? drawing;
  return <div className="absolute inset-0 z-20 flex justify-center bg-[#F9F7E9] px-4 pb-[min(31dvh,14rem)] pt-3">
    <svg viewBox="0 0 1000 1000" className="h-full w-full" aria-label="公交线网题面" role="img">
      {drawing.raster && <image href={`data:image/png;base64,${drawing.raster}`} x="35" y="35" width="930" height="930" />}
      {drawing.county && <circle cx="500" cy="500" r="465" fill="none" stroke="#ccd9d4" strokeWidth="2" />}
      {drawing.basemap && <path d={drawing.basemap} fill="none" stroke="#d4dbd6" strokeWidth="2" strokeLinecap="round" />}
      <path d={frame.path} fill="none" stroke="#346DB3" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {frame.stops.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="3.5" fill="#346DB3" stroke="white" />)}
      {drawing.arrows?.map(([x, y, angle], index) => <path key={index} d="M-7 -6L0 0L-7 6" transform={`translate(${x} ${y}) rotate(${angle})`} fill="none" stroke="#203f35" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />)}
      {drawing.terminals.flatMap(({ first, last }, index) => [
        <circle key={`${index}-first`} cx={first[0]} cy={first[1]} r="6" fill="#16a34a" stroke="white" />,
        <circle key={`${index}-last`} cx={last[0]} cy={last[1]} r="5" fill="#ef4444" stroke="white" />,
      ])}
      {drawing.target && <circle cx={drawing.target[0]} cy={drawing.target[1]} r="9" fill="#ef4444" stroke="white" strokeWidth="2" />}
    </svg>
  </div>;
}
