import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

// Coordinates follow the user's 1584 × 762 reference: campus west of the railway,
// its east gate on the north–south corridor, and the Lucheng network to the east.
const corridors = [
  { color: '#5E8271', path: 'M250 -30 L354 457 L420 790' },
  { color: '#5E8271', path: 'M105 240 L580 194 L587 338 L717 326' },
  { color: '#5E8271', path: 'M354 457 L588 468' },
  { color: '#C29B63', path: 'M587 338 L597 790' },
  { color: '#C29B63', path: 'M588 468 L1306 476' },
  { color: '#5E8271', path: 'M602 686 L705 686' },
  { color: '#5E8271', path: 'M987 -30 L973 88 L1057 88' },
  { color: '#5E8271', path: 'M975 196 L1584 190' },
  { color: '#5E8271', path: 'M985 283 L1518 282' },
  { color: '#5E8271', path: 'M1057 93 L1057 244 L1116 244 L1116 283' },
  { color: '#5E8271', path: 'M1194 95 L1196 376' },
  { color: '#5E8271', path: 'M1090 483 L1204 680 L1242 762' },
  { color: '#5E8271', path: 'M1204 680 L1263 665 M1290 681 L1284 762 M1360 659 L1584 653' },
  { color: '#C29B63', path: 'M967 95 L964 199 L976 258 L987 282 L1071 282' },
  { color: '#C29B63', path: 'M1057 98 L1057 174' },
  { color: '#C29B63', path: 'M1114 299 L1114 346 L1128 381 L1288 383 L1322 396 L1517 396' },
  { color: '#C29B63', path: 'M1178 -20 L1197 87' },
  { color: '#C29B63', path: 'M1294 -20 L1309 475 L1384 790' },
  { color: '#C29B63', path: 'M1300 77 L1584 51 M1304 198 L1516 180' },
  { color: '#C29B63', path: 'M1255 670 L1281 660 L1354 654 L1518 651' },
  { color: '#B56666', path: 'M1028 89 L1196 90 L1302 78' },
  { color: '#B56666', path: 'M1308 476 L1363 485 L1440 495 L1521 501 L1584 503' },
  { color: '#B56666', path: 'M1516 -20 L1522 60 L1522 790' },
];
const streets = [
  'M0 122 L251 78 M0 194 L287 150 M0 295 L300 252',
  'M103 0 L139 196 M180 0 L218 220 M0 490 L340 442 M0 643 L386 603',
  'M379 220 L407 587 L582 576 M413 213 L441 416 M441 416 L580 410',
  'M600 501 L764 497 L779 762 M603 535 L769 533 M604 598 L774 595 M675 497 L681 687 M733 497 L739 684',
  'M603 708 L769 708 M602 748 L774 748 M632 687 L635 762',
  'M720 326 L831 314 L840 394 L910 391 M765 115 L883 93 L924 93',
  'M1023 101 L1014 241 M1012 333 L1114 329 M1135 16 L1144 194',
  'M1333 114 L1448 102 L1457 193 M1344 139 L1451 128 M1388 193 L1390 282',
  'M1324 316 L1516 310 M1331 352 L1515 346 M1387 282 L1396 393 M1465 282 L1468 392',
  'M1130 522 L1319 520 M1161 576 L1336 573 M1211 614 L1346 607 M1219 484 L1280 642',
];
export function DaxingMapPreview({ thickness, searchMode, replay, showCampusArrow }: {
  thickness: 'thick' | 'thin'; searchMode: 'fast' | 'realtime' | 'static'; replay: number; showCampusArrow: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const width = thickness === 'thin' ? 7 : 13;
  return <div className="relative w-full aspect-[1584/762] rounded-2xl overflow-hidden border border-m3-outline-variant/40 bg-[#EBEFEC] select-none">
    <svg viewBox="0 0 1584 762" role="img" aria-label="北京建筑大学大兴校区及东侧芦城公交线网示意图" className="block w-full h-full">
      <rect width="1584" height="762" fill="#ECEFED" />
      <path d="M0 0 H248 L387 762 H0Z" fill="#E1EBE5" />
      <path d="M354 218 L579 195 L589 590 L400 610Z" fill="#D6DAD8" />
      <path d="M300 0 H554 L582 194 L350 216Z" fill="#E2EBE5" />
      <path d="M875 408 L1036 762 H1154 L952 403Z" fill="#E2EBE5" />
      <path d="M1206 690 L1256 762 H1134 L1110 693Z" fill="#DCE8DE" />
      <g fill="#E8EDE9">{[[410,231,65,18],[462,294,51,19],[441,352,30,20],[489,384,47,16],[455,453,69,16],[417,493,29,48],[522,521,31,38],[640,555,56,30],[1358,220,102,45]].map(([x,y,w,h],i)=><rect key={i} x={x} y={y} width={w} height={h} rx="3" />)}</g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">{streets.map((path,index)=><g key={index}><path d={path} stroke="#C3CAC6" strokeWidth="8" /><path d={path} stroke="#FAFBFA" strokeWidth="4" /></g>)}</g>
      <g fill="none" stroke="#BDC5C0" strokeWidth="5" strokeDasharray="19 13"><path d="M959 -20 Q906 135 913 254 Q925 433 1131 782" /><path d="M980 -20 Q930 140 941 262 Q954 444 1155 782" /></g>
      <g key={`${searchMode}-${replay}`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {corridors.map((route,index)=>{
          const progressive = searchMode === 'realtime' && !reducedMotion;
          const duration = reducedMotion || searchMode === 'static' ? 0 : progressive ? 0.24 : 0.32;
          const delay = progressive ? index * 0.035 : 0;
          return <motion.g key={index} initial={searchMode === 'static' || reducedMotion ? false : { opacity: 0 }} animate={{ opacity: searchMode === 'fast' ? 0.65 : 0.94 }} transition={{ duration, delay }}>
            <motion.path d={route.path} stroke="#FFFFFF" strokeWidth={width + 6} initial={progressive ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration, delay }} style={{ transition: 'stroke-width 220ms ease' }} />
            <motion.path d={route.path} stroke={route.color} strokeWidth={width} initial={progressive ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration, delay }} style={{ transition: 'stroke-width 220ms ease' }} />
          </motion.g>;
        })}
      </g>
      <g fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fontWeight="650" fontSize="32" fill="#4B6058" paintOrder="stroke" stroke="#F7F9F7" strokeWidth="7" strokeLinejoin="round">
        <text x="106" y="640">黄村城市森林公园</text>
        <text x="611" y="166">兴安公寓</text>
        <text x="1014" y="341" fontSize="28">首开康乃馨</text>
        <text x="1330" y="250" fontSize="28">枣园小区</text>
        <text x="1141" y="562" fontSize="28">大兴·星光城</text>
      </g>
      <g fill="#4A8DD7" stroke="#FFF" strokeWidth="5"><circle cx="484" cy="335" r="14" /><circle cx="739" cy="357" r="13" /><circle cx="675" cy="738" r="13" /></g>
      <g fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fontWeight="750" fontSize="33" fill="#344B5E" paintOrder="stroke" stroke="#FFFFFF" strokeWidth="8" strokeLinejoin="round">
        <text x="511" y="327"><tspan x="511">北京建筑大学</tspan><tspan x="511" dy="38">大兴校区</tspan></text>
        <text x="770" y="349" fontSize="27"><tspan x="770">北京四中</tspan><tspan x="770" dy="33">永定湾校区</tspan></text>
        <text x="704" y="717" fontSize="28"><tspan x="704">大兴第一</tspan><tspan x="704" dy="34">中学西校区</tspan></text>
      </g>
      <AnimateCampusArrow show={showCampusArrow} reduced={!!reducedMotion} />
    </svg>
    <div className="absolute top-2 right-2 flex gap-2 bg-m3-surface/95 rounded-full px-2.5 py-1 shadow-sm text-[9px] font-bold text-slate-600" aria-label="线路密度：绿低，黄中，红高">{[['#5E8271','低'],['#C29B63','中'],['#B56666','高']].map(([color,label])=><span key={label} className="flex items-center gap-1"><i className="w-2 h-2 rounded-full" style={{backgroundColor:color}} />{label}</span>)}</div>
  </div>;
}
function AnimateCampusArrow({ show, reduced }: { show: boolean; reduced: boolean }) {
  return show ? <motion.g aria-label="公共API提供者：北京建筑大学大兴校区" initial={{ opacity: 0 }} animate={{ opacity: 1, y: reduced ? 0 : [0, -9, 0] }} transition={{ opacity: { duration: 0.2 }, y: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } }}>
    <path d="M484 244 V303 M464 285 L484 306 L504 285" fill="none" stroke="#FFFFFF" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M484 244 V303 M464 285 L484 306 L504 285" fill="none" stroke="#346DB3" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
  </motion.g> : null;
}
