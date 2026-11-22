import React, { useEffect, useMemo, useRef, useState } from 'react';
import { JinzhouBvpPanel } from './JinzhouBvpPanel';

// 开发期线路几何压缩对比面板（仅 import.meta.env.DEV + ?debugGeometry=1 时挂载）。
// 数据由 vite 开发中间件 /__debug/geometry/* 提供，不进入生产构建。

interface LineSummary { id: string; name: string; startStop: string; endStop: string; points: number; hasRaw: boolean; }
interface LayerData { original: [number, number][]; deltaRestored: [number, number][]; direction720: [number, number][]; rdp: [number, number][]; }
interface DevStat { max: number; avg: number; p95: number; maxPoint: [number, number] | null; count: number; }
interface LineDebug {
  id: string; name: string; startStop: string; endStop: string; bounds: [number, number, number, number]; epsilon: number;
  layers: LayerData; stats: { delta: DevStat; direction720: DevStat; rdp: DevStat };
  sizes: { points: number; rawJson: number; deltaJson: number; varint: number; brotli: number; rdpPoints: number; lengthMeters: number };
}

const LAYERS: { key: keyof LayerData; label: string; color: string; weight: number }[] = [
  { key: 'original', label: '原始', color: '#ff3b30', weight: 5 },
  { key: 'deltaRestored', label: '差分还原(无损)', color: '#0a84ff', weight: 3 },
  { key: 'direction720', label: '720方向', color: '#ffd60a', weight: 3 },
  { key: 'rdp', label: 'RDP简化', color: '#30d158', weight: 4 },
];

export function GeometryDebugPanel({ map }: { map: any }) {
  const [lines, setLines] = useState<LineSummary[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LineDebug | null>(null);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState<Record<string, boolean>>({ original: true, deltaRestored: true, direction720: true, rdp: true });
  const [dataset, setDataset] = useState<'fuxin' | 'jinzhou'>('fuxin');
  const overlaysRef = useRef<any[]>([]);
  const polyRef = useRef<Record<string, any>>({});

  useEffect(() => {
    fetch('/__debug/geometry/index').then((r) => r.json())
      .then((d) => { if (Array.isArray(d.lines)) setLines(d.lines); else setError(d.error || '加载索引失败'); })
      .catch((e) => setError(String(e)));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? lines.filter((l) => l.name.toLowerCase().includes(q) || l.id.includes(q)) : lines;
    return list.slice(0, 60);
  }, [lines, query]);

  useEffect(() => () => clearOverlays(), []);

  function clearOverlays() {
    for (const overlay of overlaysRef.current) { try { map?.remove(overlay); } catch { /* ignore */ } }
    overlaysRef.current = []; polyRef.current = {};
  }

  // AMap 2.0 用 show()/hide()；部分版本有 setVisible()。统一兼容。
  function setOverlayVisible(poly: any, visibleFlag: boolean) {
    if (!poly) return;
    if (typeof poly.setVisible === 'function') poly.setVisible(visibleFlag);
    else if (visibleFlag) poly.show?.();
    else poly.hide?.();
  }

  function renderLayers(data: LineDebug) {
    const AMap = (window as any).AMap; if (!AMap || !map) return;
    clearOverlays();
    for (const layer of LAYERS) {
      const path = data.layers[layer.key];
      if (!Array.isArray(path) || path.length < 2) continue;
      const polyline = new AMap.Polyline({
        path, strokeColor: layer.color, strokeWeight: layer.weight, strokeOpacity: 0.85,
        lineJoin: 'round', lineCap: 'round', showDir: false, bubble: true,
      });
      map.add(polyline);
      setOverlayVisible(polyline, !!visible[layer.key]);
      overlaysRef.current.push(polyline); polyRef.current[layer.key] = polyline;
    }
    try { map.setFitView(overlaysRef.current, false, [60, 60, 60, 60]); } catch { /* ignore */ }
  }

  async function selectLine(item: LineSummary) {
    setError(''); setSelected(null); clearOverlays();
    try {
      const res = await fetch(`/__debug/geometry/line?id=${encodeURIComponent(item.id)}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setSelected(data as LineDebug);
      renderLayers(data as LineDebug);
    } catch (e: any) { setError(String(e)); }
  }

  function toggle(key: string, checked: boolean) {
    setVisible((v) => ({ ...v, [key]: checked }));
    setOverlayVisible(polyRef.current[key], checked);
  }

  function locate(point?: [number, number] | null) { if (point && map) { try { map.setZoomAndCenter(16, point); } catch { /* ignore */ } } }

  return (
    <div className="fixed top-2 right-2 z-[300] w-[340px] max-w-[calc(100vw-16px)] max-h-[92vh] overflow-auto rounded-2xl bg-slate-900/95 text-white text-xs p-3 shadow-2xl border border-slate-700 pointer-events-auto">
      <h3 className="font-bold text-sm mb-2">线路几何压缩对比 <span className="text-[10px] text-emerald-400">DEV</span></h3>
      <div className="flex gap-1 mb-2">
        <button onClick={() => setDataset('fuxin')} className={`flex-1 rounded-lg py-1 font-bold ${dataset === 'fuxin' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>阜新(实验)</button>
        <button onClick={() => setDataset('jinzhou')} className={`flex-1 rounded-lg py-1 font-bold ${dataset === 'jinzhou' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>锦州 BVP1</button>
      </div>
      {dataset === 'jinzhou' && <JinzhouBvpPanel map={map} />}
      {dataset === 'fuxin' && (<>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按线路名称或 ID 搜索…"
        className="w-full mb-2 rounded-lg bg-slate-800 px-2 py-1.5 outline-none border border-slate-600 focus:border-sky-400" />
      {error && <p className="text-amber-400 mb-2 whitespace-pre-wrap">{error}</p>}
      <div className="grid grid-cols-2 gap-1 mb-2">
        {LAYERS.map((l) => (
          <label key={l.key} className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={!!visible[l.key]} onChange={(e) => toggle(l.key, e.target.checked)} className="accent-sky-400" />
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: l.color }} />{l.label}
          </label>
        ))}
      </div>
      {!selected && (
        <div className="max-h-[46vh] overflow-auto border border-slate-700 rounded-lg divide-y divide-slate-800">
          {filtered.map((l) => (
            <button key={l.id} onClick={() => selectLine(l)} className="block w-full text-left px-2 py-1.5 hover:bg-slate-800">
              <span className="font-bold text-sky-300">{l.id}</span> · {l.name} <span className="text-slate-500">({l.points}点)</span>
            </button>
          ))}
          {!filtered.length && <p className="p-2 text-slate-500">无匹配线路</p>}
        </div>
      )}
      {selected && <LineResult data={selected} onBack={() => { setSelected(null); clearOverlays(); }} onLocate={locate} />}
      </>)}
    </div>
  );
}

function LineResult({ data, onBack, onLocate }: { data: LineDebug; onBack: () => void; onLocate: (p?: [number, number] | null) => void }) {
  const rows: { key: string; label: string; color: string; stat: DevStat }[] = [
    { key: 'deltaRestored', label: '差分还原(无损)', color: '#0a84ff', stat: data.stats.delta },
    { key: 'direction720', label: '720方向', color: '#ffd60a', stat: data.stats.direction720 },
    { key: 'rdp', label: 'RDP简化', color: '#30d158', stat: data.stats.rdp },
  ];
  const z = data.sizes;
  return (
    <div className="space-y-2">
      <button onClick={onBack} className="text-sky-300 underline">← 返回列表</button>
      <div>
        <p className="font-bold">{data.name}</p>
        <p className="text-slate-400">{data.id} · {data.startStop} → {data.endStop}</p>
        <p className="text-slate-400">{z.points} 点 · 约 {z.lengthMeters} 米 · RDP eps={data.epsilon}m</p>
      </div>
      <div className="rounded-lg bg-slate-800 p-2 space-y-1">
        <p className="font-bold text-slate-300">几何偏差（米，点到线段距离）</p>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 shrink-0"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: r.color }} />{r.label}</span>
            <span className="tabular-nums text-slate-300">max {r.stat.max.toFixed(2)} · avg {r.stat.avg.toFixed(2)} · p95 {r.stat.p95.toFixed(2)}</span>
            <button onClick={() => onLocate(r.stat.maxPoint)} className="text-sky-300 underline shrink-0">定位</button>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-slate-800 p-2 text-slate-300 space-y-0.5">
        <p className="font-bold text-slate-300 mb-1">编码体积（字节）</p>
        <p>原始 JSON: {z.rawJson.toLocaleString()}</p>
        <p>delta JSON: {z.deltaJson.toLocaleString()}</p>
        <p>varint: {z.varint.toLocaleString()}</p>
        <p>brotli(varint): <span className="text-emerald-300">{z.brotli.toLocaleString()}</span>（占原始 {(z.brotli / z.rawJson * 100).toFixed(1)}%）</p>
        <p>RDP: {z.rdpPoints} 点</p>
      </div>
    </div>
  );
}
