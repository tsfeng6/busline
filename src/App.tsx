import { useEffect, useRef, useState, useCallback } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { BusStop, BusLine, LineSegment } from './types';
import { Bus, Map as MapIcon, ZoomIn, Info, Loader2, List, X, Search, Settings, Camera, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';

const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || '20f5c6b65349e5d4cb5f58c7e0c4a4ba'; 
const SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE || '312d8a4369a48971f1f9e2b19280d075';

if (typeof window !== 'undefined') {
  (window as any)._AMapSecurityConfig = {
    securityJsCode: SECURITY_CODE,
  };
}

export default function App() {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapClickHandlerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [selectedSegmentLines, setSelectedSegmentLines] = useState<string[] | null>(null);
  const [selectedStop, setSelectedStop] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showLargeAreaWarning, setShowLargeAreaWarning] = useState(false);
  const [stats, setStats] = useState({ stops: 0, lines: 0 });
  const [showToolbox, setShowToolbox] = useState(false);
  const [baseMapVisible, setBaseMapVisible] = useState(true);
  const [selectionPos, setSelectionPos] = useState<[number, number] | null>(null);
  const [selectedSegmentName, setSelectedSegmentName] = useState<string | null>(null);

  const fetchedLinesCache = useRef<Map<string, BusLine>>(new Map());
  const polylinesRef = useRef<any[]>([]);

  const selectionMarkerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

  const [containerPos, setContainerPos] = useState<{ x: number, y: number } | null>(null);

  const updatePopupPos = useCallback(() => {
    const map = mapRef.current;
    if (map && selectionPos) {
      const pixel = map.lngLatToContainer(selectionPos);
      setContainerPos({ x: pixel.getX(), y: pixel.getY() });
    }
  }, [selectionPos]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && selectionPos) {
      updatePopupPos();
      map.on('mapmove', updatePopupPos);
      map.on('zoomchange', updatePopupPos);
      return () => {
        map.off('mapmove', updatePopupPos);
        map.off('zoomchange', updatePopupPos);
      };
    }
  }, [selectionPos, updatePopupPos]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !(window as any).AMap) return;

    if (!geocoderRef.current) {
      geocoderRef.current = new (window as any).AMap.Geocoder({
        radius: 50,
        extensions: 'all'
      });
    }

    if (selectionPos) {
      if (!selectionMarkerRef.current) {
        selectionMarkerRef.current = new (window as any).AMap.Marker({
          position: selectionPos,
          content: `
            <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: flex-end; justify-content: center;">
              <div style="position: absolute; width: 24px; height: 24px; background: #ef4444; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4); border: 2.5px solid white; margin-bottom: 12px;">
                <div style="width: 8px; height: 8px; background: white; border-radius: 50%; transform: rotate(45deg);"></div>
              </div>
              <div style="width: 14px; height: 6px; background: rgba(0,0,0,0.15); border-radius: 50%; filter: blur(2px);"></div>
            </div>
          `,
          offset: new (window as any).AMap.Pixel(-20, -40),
          zIndex: 100
        });
        
        selectionMarkerRef.current.setMap(map);
      } else {
        selectionMarkerRef.current.setPosition(selectionPos);
      }
    } else {
      if (selectionMarkerRef.current) {
        map.remove(selectionMarkerRef.current);
        selectionMarkerRef.current = null;
      }
    }
  }, [selectionPos]);

  useEffect(() => {
    let map: any;

    AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.PlaceSearch', 'AMap.LineSearch', 'AMap.Scale', 'AMap.ToolBar', 'AMap.Geocoder'],
    }).then((AMap) => {
      map = new AMap.Map(containerRef.current, {
        center: [116.397428, 39.90923], 
        zoom: zoomLevel,
        viewMode: '2D',
        mapStyle: 'amap://styles/whitesmoke', 
      });

      mapRef.current = map;
      setLoading(false);

      map.on('zoomend', () => {
        const newZoom = map.getZoom();
        setZoomLevel((prevZoom) => {
          if (newZoom < 14) {
            handleClear();
          }
          return newZoom;
        });
      });
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });

    return () => {
      if (map) map.destroy();
    };
  }, []);

  const handleSearch = async () => {
    const map = mapRef.current;
    if (!map) return;

    const currentZoom = map.getZoom();
    if (currentZoom < 14) {
      return;
    }

    setShowLargeAreaWarning(false);

    setIsSearching(true);
    try {
      const AMap = (window as any).AMap;
      
      const center = map.getCenter();
      let currentCity = '北京';
      
      try {
        const geocoder = new AMap.Geocoder();
        const addressResult: any = await new Promise((resolve) => {
          geocoder.getAddress(center, (status: string, result: any) => {
            resolve(status === 'complete' ? result : null);
          });
        });
        if (addressResult && addressResult.regeocode.addressComponent.city) {
          currentCity = addressResult.regeocode.addressComponent.city;
        } else if (addressResult && addressResult.regeocode.addressComponent.province) {
          currentCity = addressResult.regeocode.addressComponent.province;
        }
      } catch (e) {
        console.warn('City detection failed', e);
      }

      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const boundCenter = bounds.getCenter();
      
      const lngDiff = ne.lng - sw.lng;
      const latDiff = ne.lat - sw.lat;

      const expandedBounds = new AMap.Bounds(
        [boundCenter.lng - lngDiff * 1.5, boundCenter.lat - latDiff * 1.5],
        [boundCenter.lng + lngDiff * 1.5, boundCenter.lat + latDiff * 1.5]
      );
      
      const placeSearch = new AMap.PlaceSearch({
        type: '公交车站',
        pageSize: 100, 
        city: currentCity,
        pageIndex: 1,
        extensions: 'all',
      });

      placeSearch.searchInBounds('', expandedBounds, async (status: string, result: any) => {
        if (status === 'complete' && result.poiList) {
          const pois = result.poiList.pois;
          setStats(prev => ({ ...prev, stops: pois.length }));
          
          if (polylinesRef.current.length > 0) {
            map.remove(polylinesRef.current);
            polylinesRef.current = [];
          }

          pois.forEach((poi: any) => {
            const marker = new AMap.CircleMarker({
              center: [poi.location.lng, poi.location.lat],
              radius: 6,
              fillColor: '#3b82f6',
              strokeColor: '#fff',
              strokeWeight: 2,
              bubble: true,
              zIndex: 30,
              cursor: 'pointer'
            });

            marker.on('click', (e: any) => {
              setSelectionPos([e.lnglat.lng, e.lnglat.lat]);
              setSelectedSegmentLines(null);
              setSelectedSegmentName(null);
              setSelectedStop({
                name: poi.name,
                address: poi.address,
                lines: (poi.address || '').split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0),
                city: currentCity
              });
            });

            marker.setMap(map);
            polylinesRef.current.push(marker);
          });

          const lineNamesSet = new Set<string>();
          pois.forEach((poi: any) => {
            const linesString = poi.address || '';
            const lines = linesString.split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            lines.forEach((l: string) => lineNamesSet.add(l));
          });

          await fetchAndDrawLines(Array.from(lineNamesSet), map, AMap, currentCity);
        }
        setIsSearching(false);
      });
    } catch (error) {
      console.error('Search error:', error);
      setIsSearching(false);
    }
  };

  const fetchAndDrawLines = async (lineNames: string[], map: any, AMap: any, city: string) => {
    const linesToFetch = lineNames.filter(name => !fetchedLinesCache.current.has(name));
    
    if (linesToFetch.length > 0) {
      const lineSearch = new AMap.LineSearch({
        pageIndex: 1,
        city: city,
        pageSize: 10,
        extensions: 'all'
      });

      const batchSize = 5;
      for (let i = 0; i < linesToFetch.length; i += batchSize) {
        const batch = linesToFetch.slice(i, i + batchSize);
        await Promise.all(batch.map(name => new Promise<void>((resolve) => {
          lineSearch.search(name, (status: string, result: any) => {
            if (status === 'complete' && result.lineInfo && result.lineInfo.length > 0) {
              result.lineInfo.forEach((info: any, index: number) => {
                const uniqueName = info.name || `${name}#${index}`;
                fetchedLinesCache.current.set(uniqueName, {
                  id: info.id,
                  name: uniqueName,
                  path: info.path.map((p: any) => [p.lng, p.lat]),
                  start_stop: info.start_stop,
                  end_stop: info.end_stop,
                  stops: []
                });
              });
            }
            resolve();
          });
        })));
      }
    }

    aggregateAndVisualize(lineNames, map, AMap);
  };

  const handleClear = () => {
    const map = mapRef.current;
    if (map && polylinesRef.current.length > 0) {
      map.remove(polylinesRef.current);
      polylinesRef.current = [];
    }
    setStats({ stops: 0, lines: 0 });
    setSelectedSegmentLines(null);
    setSelectedStop(null);
    setSelectionPos(null);
    setSelectedSegmentName(null);
  };

  const aggregateAndVisualize = (activeLineSet: string[], map: any, AMap) => {
    const expandedLineNames: string[] = [];
    const cacheKeys = Array.from(fetchedLinesCache.current.keys()) as string[];
    
    activeLineSet.forEach(name => {
      const matches = cacheKeys.filter(key => key === name || key.startsWith(`${name}(`) || key.startsWith(`${name}#`));
      if (matches.length > 0) {
        expandedLineNames.push(...matches);
      }
    });

    const pointsGrid = new Map<string, [number, number][]>();
    const getGridKey = (lng: number, lat: number) => 
      `${(lng * 1000) | 0},${(lat * 1000) | 0}`; 

    expandedLineNames.forEach(name => {
      const line = fetchedLinesCache.current.get(name);
      if (line) {
        const cleanedPath: [number, number][] = [];
        const pathLen = line.path.length;
        for (let i = 0; i < pathLen; i++) {
          const p = line.path[i];
          if (cleanedPath.length > 0) {
            const last = cleanedPath[cleanedPath.length - 1];
            const dx = p[0] - last[0];
            const dy = p[1] - last[1];
            const distSq = dx*dx + dy*dy;
            if (distSq < 1e-10) continue; 

            if (i < pathLen - 1) {
              const next = line.path[i + 1];
              const nx = next[0] - p[0];
              const ny = next[1] - p[1];
              const d2Sq = nx*nx + ny*ny;
              
              const tx = next[0] - last[0];
              const ty = next[1] - last[1];
              const d3Sq = tx*tx + ty*ty;
              
              if (distSq > 1e-6 && d2Sq > 1e-6 && d3Sq < 1e-8) continue; 
            }
          }
          cleanedPath.push(p);
          
          const key = getGridKey(p[0], p[1]);
          let cell = pointsGrid.get(key);
          if (!cell) {
            cell = [];
            pointsGrid.set(key, cell);
          }
          cell.push(p);
        }
        line.path = cleanedPath;
      }
    });

    const processedLinesPaths = new Map<string, [number, number][]>();
    const offsetLinesPaths = new Map<string, [number, number][]>();
    
    const OFFSET_VAL = 0.000035; 

    expandedLineNames.forEach(name => {
      const line = fetchedLinesCache.current.get(name);
      if (!line || line.path.length < 2) return;
      
      const splitPath: [number, number][] = [];
      for (let i = 0; i < line.path.length - 1; i++) {
        const start = line.path[i];
        const end = line.path[i+1];
        splitPath.push(start);
        
        const mids: { p: [number, number], dist: number }[] = [];
        const minGX = Math.floor(Math.min(start[0], end[0]) * 1000);
        const maxGX = Math.floor(Math.max(start[0], end[0]) * 1000);
        const minGY = Math.floor(Math.min(start[1], end[1]) * 1000);
        const maxGY = Math.floor(Math.max(start[1], end[1]) * 1000);

        for (let gx = minGX - 1; gx <= maxGX + 1; gx++) {
          for (let gy = minGY - 1; gy <= maxGY + 1; gy++) {
            const cellPoints = pointsGrid.get(`${gx},${gy}`);
            if (!cellPoints) continue;

            cellPoints.forEach(p => {
              if ((Math.abs(p[0] - start[0]) < 0.00001 && Math.abs(p[1] - start[1]) < 0.00001) || 
                  (Math.abs(p[0] - end[0]) < 0.00001 && Math.abs(p[1] - end[1]) < 0.00001)) return;
              
              const dist = distToSegment(p, start, end);
              if (dist < 0.00008) { 
                const projected = getProjection(p, start, end);
                mids.push({ p: projected, dist: getDistSq(projected, start) });
              }
            });
          }
        }
        
        mids.sort((a, b) => a.dist - b.dist);
        mids.forEach(m => {
          const last = splitPath[splitPath.length - 1];
          if (getDistSq(last, m.p) > 1e-10) { 
            splitPath.push(m.p);
          }
        });
      }
      splitPath.push(line.path[line.path.length - 1]);
      processedLinesPaths.set(name, splitPath);

      const smoothedOffsetPath: [number, number][] = [];
      const segmentNormals: [number, number][] = [];
      
      for (let i = 0; i < splitPath.length - 1; i++) {
        const p1 = splitPath[i];
        const p2 = splitPath[i+1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > 0) {
          segmentNormals.push([dy / len, -dx / len]);
        } else {
          segmentNormals.push(segmentNormals[segmentNormals.length-1] || [0, 0]);
        }
      }

      for (let i = 0; i < splitPath.length; i++) {
        const p = splitPath[i];
        let nx = 0, ny = 0;
        const windowSize = 2;
        const startIdx = Math.max(0, i - windowSize);
        const endIdx = Math.min(segmentNormals.length - 1, i + windowSize);
        let count = 0;
        for (let j = startIdx; j <= endIdx; j++) {
           nx += segmentNormals[j][0];
           ny += segmentNormals[j][1];
           count++;
        }
        nx /= count;
        ny /= count;
        
        let nLen = Math.sqrt(nx*nx + ny*ny);
        if (nLen > 0.0001) {
          nx /= nLen;
          ny /= nLen;
          
          const dot = nx * (i < segmentNormals.length ? segmentNormals[i][0] : segmentNormals[segmentNormals.length-1][0]) + 
                      ny * (i < segmentNormals.length ? segmentNormals[i][1] : segmentNormals[segmentNormals.length-1][1]);
          let miterFactor = dot > 0.5 ? 1 / dot : 1.3; 
          if (miterFactor > 1.3) miterFactor = 1.3; 
          
          smoothedOffsetPath.push([
            p[0] + nx * OFFSET_VAL * miterFactor,
            p[1] + ny * OFFSET_VAL * miterFactor
          ]);
        } else {
          smoothedOffsetPath.push([p[0] + segmentNormals[Math.min(i, segmentNormals.length-1)][0] * OFFSET_VAL, 
                                   p[1] + segmentNormals[Math.min(i, segmentNormals.length-1)][1] * OFFSET_VAL]);
        }
      }
      offsetLinesPaths.set(name, smoothedOffsetPath);
    });

    const segmentCounts = new Map<string, { start: [number, number], end: [number, number], offsetStart: [number, number], offsetEnd: [number, number], lines: Set<string> }>();
    
    expandedLineNames.forEach(name => {
      const path = processedLinesPaths.get(name);
      const oPath = offsetLinesPaths.get(name);
      if (!path || !oPath) return;

      for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i+1];
        const op1 = oPath[i];
        const op2 = oPath[i+1];
        if (p1[0] === p2[0] && p1[1] === p2[1]) continue;

        const x1 = (p1[0] * 100000) | 0;
        const y1 = (p1[1] * 100000) | 0;
        const x2 = (p2[0] * 100000) | 0;
        const y2 = (p2[1] * 100000) | 0;
        const coordKey = `${x1}${y1}${x2}${y2}`;

        let seg = segmentCounts.get(coordKey);
        if (!seg) {
          seg = { 
            start: p1, end: p2, 
            offsetStart: op1, offsetEnd: op2,
            lines: new Set() 
          };
          segmentCounts.set(coordKey, seg);
        }
        seg.lines.add(name);
      }
    });

    const finalSegments: { start: [number, number], end: [number, number], offsetStart: [number, number], offsetEnd: [number, number], lines: Set<string> }[] = [];
    const handledKeys = new Set<string>();
    
    const segmentGrid = new Map<string, string[]>();
    const GRID_SIZE = 1000; 
    const getSegGridKey = (lng: number, lat: number) => `${(lng * GRID_SIZE) | 0},${(lat * GRID_SIZE) | 0}`;

    const allKeys = Array.from(segmentCounts.keys());
    allKeys.forEach(key => {
      const s = segmentCounts.get(key)!;
      const gKey = getSegGridKey((s.start[0] + s.end[0]) * 0.5, (s.start[1] + s.end[1]) * 0.5);
      if (!segmentGrid.has(gKey)) segmentGrid.set(gKey, []);
      segmentGrid.get(gKey)!.push(key);
    });
    
    const DIST_MERGE_THRESHOLD_SQ = 0.0000000009; 
    const PARALLEL_THRESHOLD = 0.995; 
    const getBaseName = (fullName: string) => fullName.split('(')[0];

    for (let i = 0; i < allKeys.length; i++) {
      const key1 = allKeys[i];
      if (handledKeys.has(key1)) continue;
      
      const s1 = segmentCounts.get(key1)!;
      handledKeys.add(key1);
      
      const mid1x = (s1.start[0] + s1.end[0]) * 0.5;
      const mid1y = (s1.start[1] + s1.end[1]) * 0.5;
      const v1x = s1.end[0] - s1.start[0];
      const v1y = s1.end[1] - s1.start[1];
      const l1 = Math.sqrt(v1x * v1x + v1y * v1y);
      
      const mergedLines = new Set(s1.lines);
      const currentBaseNames = new Set<string>();
      mergedLines.forEach(l => currentBaseNames.add(getBaseName(l)));
      
      const gX = (mid1x * GRID_SIZE) | 0;
      const gY = (mid1y * GRID_SIZE) | 0;
      
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKeys = segmentGrid.get(`${gX + dx},${gY + dy}`);
          if (!neighborKeys) continue;
          
          for (let k = 0; k < neighborKeys.length; k++) {
            const key2 = neighborKeys[k];
            if (handledKeys.has(key2)) continue;
            
            const s2 = segmentCounts.get(key2)!;
            const mid2x = (s2.start[0] + s2.end[0]) * 0.5;
            const mid2y = (s2.start[1] + s2.end[1]) * 0.5;
            
            const diffX = mid1x - mid2x;
            const diffY = mid1y - mid2y;
            if (diffX * diffX + diffY * diffY < DIST_MERGE_THRESHOLD_SQ) {
              const v2x = s2.end[0] - s2.start[0];
              const v2y = s2.end[1] - s2.start[1];
              const l2 = Math.sqrt(v2x * v2x + v2y * v2y);
              if (l1 > 0 && l2 > 0 && Math.abs((v1x * v2x + v1y * v2y) / (l1 * l2)) > PARALLEL_THRESHOLD) {
                let hasCommonBus = false;
                for (const line of s2.lines) {
                  if (currentBaseNames.has(getBaseName(line))) {
                    hasCommonBus = true;
                    break;
                  }
                }
                
                if (!hasCommonBus) {
                  s2.lines.forEach(l => {
                    mergedLines.add(l);
                    currentBaseNames.add(getBaseName(l));
                  });
                  handledKeys.add(key2);
                }
              }
            }
          }
        }
      }
      finalSegments.push({ ...s1, lines: mergedLines });
    }

    setStats(prev => ({ ...prev, lines: activeLineSet.length }));

    const colorGroups = new Map<string, Array<[number, number][]>>();
    const segmentLookup = new Map<string, string[]>(); 

    finalSegments.forEach((data) => {
      const count = data.lines.size;
      let color = '#22c55e'; 
      if (count >= 4 && count <= 6) color = '#eab308'; 
      if (count >= 7) color = '#ef4444'; 

      const displayPath: [number, number][] = [data.offsetStart, data.offsetEnd];
      if (!colorGroups.has(color)) colorGroups.set(color, []);
      colorGroups.get(color)!.push(displayPath);
      
      const keyStr = `${data.offsetStart[0].toFixed(5)},${data.offsetStart[1].toFixed(5)}|${data.offsetEnd[0].toFixed(5)},${data.offsetEnd[1].toFixed(5)}`;
      segmentLookup.set(keyStr, Array.from(data.lines));
    });

    const allOverlays: any[] = [];
    colorGroups.forEach((paths, color) => {
      const polyline = new AMap.Polyline({
        path: paths,
        strokeColor: color,
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
        bubble: true,
        zIndex: 10
      });
      allOverlays.push(polyline);
    });

    if (polylinesRef.current.length > 0) {
      map.remove(polylinesRef.current);
    }
    
    polylinesRef.current = allOverlays;
    map.add(allOverlays);

    if (mapClickHandlerRef.current) {
      map.off('click', mapClickHandlerRef.current);
    }

    const onMapClick = (e: any) => {
      const clickLngLat = [e.lnglat.lng, e.lnglat.lat] as [number, number];
      const gX = (clickLngLat[0] * GRID_SIZE) | 0;
      const gY = (clickLngLat[1] * GRID_SIZE) | 0;
      
      const linesSet = new Set<string>();
      let found = false;
      const CLICK_THRESHOLD = 0.00012;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKeys = segmentGrid.get(`${gX + dx},${gY + dy}`);
          if (!neighborKeys) continue;
          
          neighborKeys.forEach(key => {
            const data = segmentCounts.get(key)!;
            const dist = distToSegment(clickLngLat, data.offsetStart, data.offsetEnd);
            if (dist < CLICK_THRESHOLD) {
              data.lines.forEach(l => linesSet.add(l));
              found = true;
            }
          });
        }
      }

      if (found) {
        setSelectionPos(clickLngLat);
        setSelectedStop(null);
        setSelectedSegmentName("正在获取路段信息...");
        setSelectedSegmentLines(Array.from(linesSet));
        
        if (geocoderRef.current) {
          geocoderRef.current.getAddress(clickLngLat, (status: string, result: any) => {
            if (status === 'complete' && result.regeocode) {
              const comp = result.regeocode.addressComponent;
              const road = comp.street || comp.township || comp.district;
              setSelectedSegmentName(road || "当前位置");
            } else {
              setSelectedSegmentName("当前路段");
            }
          });
        }
      }
    };

    map.on('click', onMapClick);
    mapClickHandlerRef.current = onMapClick;
  };

  const handleScreenshot = async () => {
    if (!containerRef.current) return;
    try {
      const canvas = await html2canvas(containerRef.current, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      });
      const link = document.createElement('a');
      link.download = `bus-line-screenshot-${new Date().getTime()}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (error) {
      console.error('Screenshot error:', error);
    }
  };

  const toggleBaseMap = () => {
    if (!mapRef.current) return;
    const nextValue = !baseMapVisible;
    setBaseMapVisible(nextValue);
    if (nextValue) {
      mapRef.current.setMapStyle('amap://styles/whitesmoke');
    } else {
      mapRef.current.setMapStyle('amap://styles/grey');
    }
  };

  const getDistSq = (p1: [number, number], p2: [number, number]) => {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return dx * dx + dy * dy;
  };

  const distToSegment = (p: [number, number], v: [number, number], w: [number, number]) => {
    const l2 = getDistSq(v, w);
    if (l2 === 0) return Math.sqrt(getDistSq(p, v));
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const dx = p[0] - (v[0] + t * (w[0] - v[0]));
    const dy = p[1] - (v[1] + t * (w[1] - v[1]));
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getProjection = (p: [number, number], v: [number, number], w: [number, number]): [number, number] => {
    const l2 = getDistSq(v, w);
    if (l2 === 0) return v;
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return [
      v[0] + t * (w[0] - v[0]),
      v[1] + t * (w[1] - v[1])
    ];
  };

  const parseLineInfo = (lineStr: string) => {
    const match = lineStr.match(/^(.+?)\((.+?)--(.+?)\)$/);
    if (match) {
      return { name: match[1], start: match[2], end: match[3] };
    }

    let info = fetchedLinesCache.current.get(lineStr);
    
    if (!info) {
      const shortName = lineStr.replace('路', '');
      for (const [key, value] of fetchedLinesCache.current.entries()) {
        if (key.startsWith(shortName)) {
          info = value;
          break;
        }
      }
    }

    if (info) {
      return { 
        name: info.name.split('(')[0], 
        start: info.start_stop || '始发站', 
        end: info.end_stop || '终点站' 
      };
    }
    
    return { name: lineStr, start: '-', end: '-' };
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#f8f9fa] font-sans text-slate-900 overflow-hidden relative">
      <header className="fixed top-0 left-0 right-0 z-20 px-4 pt-6 pb-0 pointer-events-none">
        <div className="flex items-start justify-between gap-4 w-full pointer-events-auto">
      <div className="backdrop-blur-xl bg-white/70 border border-white/50 pl-3 pr-5 py-2.5 rounded-2xl shadow-lg flex items-center gap-3 transition-all hover:bg-white/80 h-[56px]">
        <div className="bg-white w-10 h-10 rounded-xl shadow-sm border border-slate-100 flex items-center justify-center shrink-0 relative overflow-hidden">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 17H20" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M17 4V20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M8 20V13L13 8H22" stroke="#eab308" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex flex-col justify-center h-full">
          <h1 className="text-base font-black tracking-tighter text-slate-800 leading-none">巴士线路图</h1>
        </div>
      </div>

          <div className="flex items-center gap-3">
            <AnimatePresence>
              {stats.lines > 0 && (
                <button 
                  onClick={handleClear}
                  className="backdrop-blur-xl bg-white/70 border border-slate-200 px-4 py-3 rounded-2xl shadow-lg flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-white transition-all active:scale-95"
                >
                  <X className="w-4 h-4" />
                  清除
                </button>
              )}
            </AnimatePresence>
            
            <button 
              onClick={handleSearch}
              disabled={isSearching || zoomLevel < 14}
              className={`backdrop-blur-xl border px-6 py-3 rounded-2xl shadow-lg flex items-center gap-2 text-xs font-bold transition-all
                ${isSearching ? 'bg-amber-500/10 border-amber-200 text-amber-600 cursor-wait' : 
                  zoomLevel < 14 ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-50 shadow-none' : 
                  'bg-blue-600 border-blue-500 text-white hover:bg-blue-700 active:scale-95'}`}
            >
              {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {isSearching ? '检索中...' : '检索'}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {zoomLevel < 14 && !loading && (
            <motion.div 
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              className="absolute top-24 space-y-4 right-6 z-20 pointer-events-auto"
            >
              <div className="backdrop-blur-xl bg-white/90 border border-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 border-b-4 border-b-blue-500/50 w-full min-w-[200px]">
                <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center shrink-0">
                  <ZoomIn className="w-4 h-4 text-blue-500" />
                </div>
                <h3 className="font-bold text-slate-800 text-[13px] whitespace-nowrap">请放大地图以开始检索</h3>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showLargeAreaWarning && isSearching && (
            <motion.div 
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              className="absolute top-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
            >
              <div className="backdrop-blur-xl bg-amber-50/90 border border-amber-200 px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 border-b-4 border-b-amber-500/50">
                <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
                </div>
                <h3 className="font-bold text-amber-800 text-[13px] whitespace-nowrap">警告！线路加载较多，请等待...</h3>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="relative flex-1">
        <div ref={containerRef} className="w-full h-full" id="amap-container" />

        {loading && (
          <div className="absolute inset-0 bg-white/40 backdrop-blur-md z-30 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                <Bus className="w-5 h-5 text-blue-600 absolute inset-0 m-auto" />
              </div>
              <p className="font-bold text-slate-600 tracking-widest uppercase text-xs">Initializing System</p>
            </div>
          </div>
        )}



        <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-3 pointer-events-none">
          <motion.div 
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="backdrop-blur-xl bg-white/75 border border-white/50 px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-5 pointer-events-auto min-h-[44px]"
          >
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-1.5 rounded-full bg-emerald-500 shadow-sm" />
              <span className="text-[10px] font-black text-slate-500 uppercase">1-3 条</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-1.5 rounded-full bg-yellow-500 shadow-sm" />
              <span className="text-[10px] font-black text-slate-500 uppercase">4-6 条</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-1.5 rounded-full bg-rose-500 shadow-sm" />
              <span className="text-[10px] font-black text-slate-500 uppercase">7+ 条</span>
            </div>
          </motion.div>

          <motion.div 
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="backdrop-blur-xl bg-slate-900/85 border border-slate-700 px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-5 text-white pointer-events-auto h-[44px]"
          >
            <div className="flex items-center gap-2">
              <p className="text-base font-black leading-none">{stats.stops}</p>
              <p className="text-[9px] uppercase font-bold text-slate-400 tracking-tighter leading-none mt-0.5">站点</p>
            </div>
            <div className="w-px h-4 bg-slate-700" />
            <div className="flex items-center gap-2">
              <p className="text-base font-black leading-none">{stats.lines}</p>
              <p className="text-[9px] uppercase font-bold text-slate-400 tracking-tighter leading-none mt-0.5">线路</p>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse ml-1 shadow-glow shadow-blue-400/50" />
          </motion.div>
        </div>

        <div className="absolute top-1/2 right-4 -translate-y-1/2 z-20 flex flex-col items-center gap-4">
          <button 
            onClick={() => setShowToolbox(!showToolbox)}
            className={`p-4 rounded-full shadow-2xl transition-all border duration-300 ${
              showToolbox ? 'bg-blue-600 border-blue-400 text-white rotate-90' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Settings className="w-6 h-6" />
          </button>
          
          <AnimatePresence>
            {showToolbox && (
              <motion.div
                initial={{ opacity: 0, x: 20, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.8 }}
                className="flex flex-col gap-3 p-3 backdrop-blur-xl bg-white/70 border border-white/50 rounded-3xl shadow-2xl"
              >
                <button 
                  onClick={toggleBaseMap}
                  title="切换底图可见性"
                  className="p-3 hover:bg-white rounded-2xl transition-all text-slate-600 flex flex-col items-center gap-1 group"
                >
                  {baseMapVisible ? <Eye className="w-5 h-5 text-blue-500" /> : <EyeOff className="w-5 h-5" />}
                  <span className="text-[8px] font-bold uppercase text-slate-400">底图</span>
                </button>
                <button 
                  onClick={handleScreenshot}
                  title="截取当前视图"
                  className="p-3 hover:bg-white rounded-2xl transition-all text-slate-600 flex flex-col items-center gap-1 group"
                >
                  <Camera className="w-5 h-5 group-hover:text-amber-500" />
                  <span className="text-[8px] font-bold uppercase text-slate-400">截图</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {(selectedStop || selectedSegmentLines) && (
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="fixed left-4 top-[96px] z-40 pointer-events-auto"
            >
              <div className="backdrop-blur-2xl bg-white/95 border border-white/50 p-6 rounded-[2.5rem] shadow-2xl w-[360px] max-h-[calc(100vh-220px)] overflow-hidden flex flex-col border-t-4 border-t-blue-500 relative">
                <button 
                  onClick={() => {
                    setSelectedStop(null);
                    setSelectedSegmentLines(null);
                    setSelectionPos(null);
                    setSelectedSegmentName(null);
                  }}
                  className="absolute top-5 right-5 p-2.5 hover:bg-slate-100 rounded-2xl transition-colors bg-white shadow-sm border border-slate-100 z-10"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>

                <div className="mb-6 flex flex-col">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tighter leading-tight">
                    {selectedStop ? selectedStop.name : (selectedSegmentName === "正在获取路段信息..." ? "当前位置" : (selectedSegmentName || "当前位置"))}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="w-1.5 h-3.5 rounded-full bg-blue-500" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
                      {(selectedStop ? selectedStop.lines.length : selectedSegmentLines?.length || 0)} 条线路通过
                    </p>
                  </div>
                </div>

                <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 -mr-2">
                  <div className="flex flex-col gap-3 pb-4">
                    {(selectedStop ? selectedStop.lines : selectedSegmentLines || []).sort().map((line: string, idx: number) => {
                      const { name, start, end } = parseLineInfo(line);
                      return (
                        <div 
                          key={line + idx}
                          className="bg-white border border-slate-100 rounded-2xl p-3 flex gap-4 items-center hover:bg-slate-50 hover:border-blue-100 hover:shadow-lg transition-all group relative overflow-hidden h-[72px] shrink-0"
                        >
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500/0 group-hover:bg-blue-500 transition-all" />
                          
                          <div className="bg-slate-900 text-white font-black text-[10px] w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center shadow-md group-hover:bg-blue-600 transition-colors">
                            {name.replace('路', '')}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1 justify-center h-full">
                            <div className="flex flex-col gap-1.5">
                              {start !== '-' ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                    <span className="text-[11px] font-black text-slate-700 truncate leading-none">{start}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                                    <span className="text-[11px] font-medium text-slate-400 truncate leading-none">{end}</span>
                                  </div>
                                </>
                              ) : (
                                <div className="text-[10px] font-bold text-slate-300 italic px-1">
                                  暂无方向信息
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      <footer className="fixed bottom-4 right-4 z-20 pointer-events-none flex flex-col items-end gap-1.5">
        <div className="mr-2">
          <span className="text-[9px] font-bold text-slate-400 opacity-60 uppercase tracking-widest leading-none">@TsFeng</span>
        </div>
        <div className="backdrop-blur-xl bg-white/70 border border-white/50 p-1 px-4 rounded-xl shadow-xl flex items-center gap-2 pointer-events-auto h-[44px]">
          <div className="py-2 flex items-center gap-3 text-slate-500">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Level</span>
            <span className="text-sm font-black text-slate-700 leading-none">{zoomLevel.toFixed(1)}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={`w-1 h-1 rounded-full transition-all ${
                  (zoomLevel - 13) * 2 >= i ? 'bg-blue-500' : 'bg-slate-200'
                }`} />
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
