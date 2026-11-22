import React, { useEffect, useMemo, useRef, useState } from 'react';
import { indexCityGeometry, decodeRoute, parseBvpkHeader, type CityGeometryIndex, type GeoPath } from '../utils/bvpGeometryDecoder';

// 锦州 BVP1/BVPK1 开发期测试面板：浏览器真实调用 TS 解码器解析二进制几何（不用还原 JSON 冒充）。

interface JinLine { routeIndex: number; id: string; name: string; startStop: string; endStop: string; }
interface RestoredLine { id: string; name: string; start_stop?: string; end_stop?: string; path: GeoPath; }
interface DevStat { max: number; avg: number; p95: number; count: number; mismatch: number; lengthsEqual: boolean; orderEqual: boolean; maxPoint: [number, number] | null; }
interface Timings { jsonParseMs: number; indexMs: number; decodeAllMs: number; singleDecodeMs: number; drawMs: number; memBeforeMB: number; memAfterMB: number; }

const E5 = 111320, E5LAT = 110540;
function pointwise(original: GeoPath, decoded: GeoPath): DevStat {
  const lengthsEqual = original.length === decoded.length;
  const n = Math.min(original.length, decoded.length);
  let max = 0, sum = 0, mismatch = 0, maxPoint: [number, number] | null = null;
  const dists: number[] = [];
  const refLat = original.length ? original.reduce((s, p) => s + p[1], 0) / original.length : 0;
  const kx = E5 * Math.cos(refLat * Math.PI / 180), ky = E5LAT;
  for (let i = 0; i < n; i++) {
    const dxDeg = decoded[i][0] - original[i][0], dyDeg = decoded[i][1] - original[i][1];
    if (dxDeg !== 0 || dyDeg !== 0) mismatch++;
    const d = Math.hypot(dxDeg * kx, dyDeg * ky);
    dists.push(d); sum += d;
    if (d >= max) { max = d; maxPoint = original[i]; }
  }
  const sorted = [...dists].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.round(0.95 * (sorted.length - 1)))] : 0;
  return { max, avg: n ? sum / n : 0, p95, count: n, mismatch, lengthsEqual, orderEqual: mismatch === 0 && lengthsEqual, maxPoint };
}
const memMB = () => { const m = (performance as any).memory; return m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : -1; };

export function JinzhouBvpPanel({ map }: { map: any }) {
  const [index, setIndex] = useState<JinLine[]>([]);
  const [query, setQuery] = useState('');
  const [restored, setRestored] = useState<RestoredLine[] | null>(null);
  const [geomIndex, setGeomIndex] = useState<CityGeometryIndex | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [timings, setTimings] = useState<Timings | null>(null);
  const [selected, setSelected] = useState<{ line: JinLine; original: GeoPath; decoded: GeoPath; stat: DevStat; singleMs: number } | null>(null);
  const [bvpk, setBvpk] = useState<any>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('加载锦州实验包…');
  const [show, setShow] = useState({ original: true, decoded: true });
  const overlays = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const memBefore = memMB();
        const idxRes = await fetch('/__debug/geometry/jinzhou/index');
        const idxJson = await idxRes.json();
        if (!idxRes.ok) throw new Error(idxJson.error || '索引加载失败');
        if (cancelled) return; setIndex(idxJson.lines);
        setStatus('加载原始 JSON 与二进制几何…');
        const [restText, bvpBuf, infoJson] = await Promise.all([
          fetch('/__debug/geometry/jinzhou/file?name=restored.json').then((r) => r.text()),
          fetch('/__debug/geometry/jinzhou/file?name=paths.bvp').then((r) => r.arrayBuffer()),
          fetch('/__debug/geometry/jinzhou/info').then((r) => r.json()),
        ]);
        if (cancelled) return;
        const tParse = performance.now();
        const restoredJson = JSON.parse(restText);
        const jsonParseMs = performance.now() - tParse;
        const bvpBytes = new Uint8Array(bvpBuf);
        const tIndex = performance.now();
        const gidx = indexCityGeometry(bvpBytes);
        const indexMs = performance.now() - tIndex;
        const tAll = performance.now();
        for (let i = 0; i < gidx.spans.length; i++) decodeRoute(gidx, i);
        const decodeAllMs = performance.now() - tAll;
        setRestored(restoredJson.lines); setGeomIndex(gidx); setInfo(infoJson);
        setTimings({ jsonParseMs, indexMs, decodeAllMs, singleDecodeMs: 0, drawMs: 0, memBeforeMB: memBefore, memAfterMB: memMB() });
        setStatus('');
      } catch (e: any) { if (!cancelled) setError(String(e.message || e)); }
    })();
    return () => { cancelled = true; clearOverlays(); };
  }, []);

  function clearOverlays() { for (const o of overlays.current) { try { map?.remove(o); } catch { /* ignore */ } } overlays.current = []; }
  function setVis(poly: any, v: boolean) { if (!poly) return; if (typeof poly.setVisible === 'function') poly.setVisible(v); else if (v) poly.show?.(); else poly.hide?.(); }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? index.filter((l) => l.name.toLowerCase().includes(q) || l.id.includes(q)) : index;
    return list.slice(0, 80);
  }, [index, query]);

  function selectLine(line: JinLine) {
    if (!geomIndex || !restored) return;
    setError('');
    try {
      const t = performance.now();
      const decoded = decodeRoute(geomIndex, line.routeIndex);
      const singleMs = performance.now() - t;
      const original = restored[line.routeIndex]?.path || [];
      const stat = pointwise(original, decoded);
      setSelected({ line, original, decoded, stat, singleMs });
      render(original, decoded);
    } catch (e: any) { setError(String(e.message || e)); }
  }

  function render(original: GeoPath, decoded: GeoPath) {
    const AMap = (window as any).AMap; if (!AMap || !map) return;
    clearOverlays();
    const t = performance.now();
    if (original.length > 1) { const p = new AMap.Polyline({ path: original, strokeColor: '#ff3b30', strokeWeight: 5, strokeOpacity: 0.85 }); map.add(p); overlays.current.push(p); setVis(p, show.original); }
    if (decoded.length > 1) { const p = new AMap.Polyline({ path: decoded, strokeColor: '#0a84ff', strokeWeight: 3, strokeOpacity: 0.9 }); map.add(p); overlays.current.push(p); setVis(p, show.decoded); }
    const drawMs = performance.now() - t;
    setTimings((prev) => (prev ? { ...prev, drawMs } : prev));
    try { map.setFitView(overlays.current, false, [60, 60, 60, 60]); } catch { /* ignore */ }
  }

  function toggle(key: 'original' | 'decoded', v: boolean) {
    setShow((s) => ({ ...s, [key]: v }));
    setVis(overlays.current[key === 'original' ? 0 : 1], v);
  }

  function locate() { if (selected && selected.stat.maxPoint && map) map.setZoomAndCenter(16, selected.stat.maxPoint); }

  async function testBvpk() {
    setBvpk(null); setError('');
    try {
      const buf = await fetch('/__debug/geometry/jinzhou/file?name=city.bvpk').then((r) => r.arrayBuffer());
      const header = parseBvpkHeader(new Uint8Array(buf));
      if (!header.valid) throw new Error(`BVPK1 头无效：magic=${header.magic} total=${header.totalLength}`);
      const blocks = await fetch('/__debug/geometry/jinzhou/bvpk-blocks').then((r) => r.json());
      if (blocks.error) throw new Error(blocks.error);
      const geom = Uint8Array.from(atob(blocks.geomBase64), (c) => c.charCodeAt(0));
      const gidx = indexCityGeometry(geom);
      const metaCount = blocks.meta.lines.length;
      const consistent = metaCount === gidx.spans.length;
      const t = performance.now();
      let points = 0, mism = 0;
      for (let i = 0; i < gidx.spans.length; i++) { const dp = decodeRoute(gidx, i); points += dp.length; const orig = (blocks.meta.lines[i] && restored?.[i]?.path) || []; if (orig.length && (dp.length !== orig.length)) mism++; }
      const ms = performance.now() - t;
      setBvpk({ header, metaCount, spanCount: gidx.spans.length, consistent, points, mism, ms });
    } catch (e: any) { setError(`BVPK1 测试失败（已回退到原始数据）：${e.message || e}`); }
  }

  return (
    <div className="space-y-2">
      {status && <p className="text-sky-300">{status}</p>}
      {error && <p className="text-amber-400 whitespace-pre-wrap">{error}</p>}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按线路名称或 ID 搜索（锦州 186 条）…"
        className="w-full rounded-lg bg-slate-800 px-2 py-1.5 outline-none border border-slate-600 focus:border-sky-400" />
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={show.original} onChange={(e) => toggle('original', e.target.checked)} /><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ff3b30' }} />原始</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={show.decoded} onChange={(e) => toggle('decoded', e.target.checked)} /><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#0a84ff' }} />BVP1解码</label>
      </div>
      {!selected && (
        <div className="max-h-[40vh] overflow-auto border border-slate-700 rounded-lg divide-y divide-slate-800">
          {filtered.map((l) => (<button key={l.id} onClick={() => selectLine(l)} className="block w-full text-left px-2 py-1 hover:bg-slate-800"><span className="font-bold text-sky-300">{l.id}</span> · {l.name}</button>))}
          {!filtered.length && <p className="p-2 text-slate-500">无匹配线路</p>}
        </div>
      )}
      {selected && (
        <div className="space-y-2">
          <button onClick={() => { setSelected(null); clearOverlays(); }} className="text-sky-300 underline">← 返回列表</button>
          <p className="font-bold">{selected.line.name}</p>
          <p className="text-slate-400">{selected.line.id} · {selected.line.startStop} → {selected.line.endStop}</p>
          <div className="rounded-lg bg-slate-800 p-2 space-y-1">
            <p className="font-bold text-slate-300">原始 vs BVP1解码</p>
            <p>点数: 原始 {selected.original.length} / 解码 {selected.decoded.length} · {selected.stat.lengthsEqual ? '一致' : '不一致'}</p>
            <p>逐点经纬度: {selected.stat.mismatch === 0 ? '完全一致（0 处差异）' : `${selected.stat.mismatch} 处差异`}</p>
            <p className="tabular-nums">偏差(米): max {selected.stat.max.toFixed(3)} · avg {selected.stat.avg.toFixed(3)} · p95 {selected.stat.p95.toFixed(3)}</p>
            <button onClick={locate} className="text-sky-300 underline">定位</button>
          </div>
        </div>
      )}
      {timings && (() => {
        const sz = info?.sizes || {};
        return (
          <div className="rounded-lg bg-slate-800 p-2 text-slate-300 space-y-0.5">
            <p className="font-bold text-slate-300">性能（第二阶段）</p>
            <p>网络字节: 原始JSON {sz['restored.json']?.toLocaleString?.() ?? sz['restored.json']} · city.bvpk {sz['city.bvpk']?.toLocaleString?.() ?? sz['city.bvpk']}</p>
            <p>几何Brotli br: {sz['paths.bvp.br']?.toLocaleString?.() ?? '-'} · meta br: {sz['meta.json.br']?.toLocaleString?.() ?? '-'}</p>
            <p>Brotli解压(Node): geom {info?.geomBrotliMs?.toFixed?.(2)} ms · meta {info?.metaBrotliMs?.toFixed?.(2)} ms</p>
            <p>JSON解析(原始): {timings.jsonParseMs.toFixed(1)} ms</p>
            <p>BVP1 index: {timings.indexMs.toFixed(2)} ms · 全186解码: {timings.decodeAllMs.toFixed(2)} ms</p>
            <p>单线解码: {selected ? selected.singleMs.toFixed(3) : '-'} ms · 绘制: {timings.drawMs.toFixed(2)} ms</p>
            <p>JS堆: {timings.memBeforeMB >= 0 ? `${timings.memBeforeMB}→${timings.memAfterMB} MB` : '不可用(非Chrome)'}</p>
          </div>
        );
      })()}
      <div className="rounded-lg bg-slate-800 p-2 space-y-1">
        <p className="font-bold text-slate-300">第三阶段：BVPK1 容器</p>
        <button onClick={testBvpk} className="px-2 py-1 rounded bg-sky-600 text-white">校验 city.bvpk 容器（真实解包+解码）</button>
        {bvpk && <div className="text-slate-300 space-y-0.5">
          <p>头: {bvpk.header.magic} meta {bvpk.header.metaLength}B · geom {bvpk.header.geomLength}B · valid {String(bvpk.header.valid)}</p>
          <p>元数据线路 {bvpk.metaCount} / 几何线路 {bvpk.spanCount} · {bvpk.consistent ? '一致 ✓' : '不一致 ✗'}</p>
          <p>解码全部: {bvpk.points} 点 · 长度不一致线路 {bvpk.mism} · {bvpk.ms.toFixed(1)} ms</p>
          <p className="text-slate-500">（Brotli 块在 Node 侧解压；几何由浏览器真实 TS 解码；失败自动回退原始）</p>
        </div>}
      </div>
    </div>
  );
}
