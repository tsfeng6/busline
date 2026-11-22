import React, { useEffect, useMemo, useRef, useState } from 'react';
import { indexCityGeometry, decodeRoute, parseBvpkHeader, type CityGeometryIndex, type GeoPath } from '../utils/bvpGeometryDecoder';

// 通用 BVP1/BVPK1 开发期测试面板（锦州 / 北京）。浏览器真实调用 TS 解码器；BVPK1 的 Brotli 走浏览器原生 Content-Encoding。

type BvpCity = 'jinzhou' | 'beijing';
interface JinLine { routeIndex: number; id: string; name: string; startStop: string; endStop: string; }
interface DevStat { lengthsEqual: boolean; mismatch: number; max: number; avg: number; p95: number; maxPoint: [number, number] | null; count: number; }
const E5 = 111320, E5LAT = 110540;
function pointwise(original: GeoPath, decoded: GeoPath): DevStat {
  const lengthsEqual = original.length === decoded.length; const n = Math.min(original.length, decoded.length);
  let max = 0, sum = 0, mismatch = 0, maxPoint: [number, number] | null = null; const dists: number[] = [];
  const refLat = original.length ? original.reduce((s, p) => s + p[1], 0) / original.length : 0;
  const kx = E5 * Math.cos(refLat * Math.PI / 180), ky = E5LAT;
  for (let i = 0; i < n; i++) {
    const dx = decoded[i][0] - original[i][0], dy = decoded[i][1] - original[i][1];
    if (dx !== 0 || dy !== 0) mismatch++;
    const d = Math.hypot(dx * kx, dy * ky); dists.push(d); sum += d;
    if (d >= max) { max = d; maxPoint = original[i]; }
  }
  const sorted = [...dists].sort((a, b) => a - b);
  return { lengthsEqual, mismatch, max, avg: n ? sum / n : 0, p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.round(0.95 * (sorted.length - 1)))] : 0, maxPoint, count: n };
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p95of = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.round(0.95 * (s.length - 1)))] : 0; };
const memMB = () => { const m = (performance as any).memory; return m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : -1; };
const fmt = (n: number) => n.toLocaleString('en-US');
const ms = (n: number) => n.toFixed(2);
async function fetchBytes(url: string): Promise<Uint8Array> { const res = await fetch(url); return new Uint8Array((await res.arrayBuffer()) as ArrayBuffer); }

export function BvpPanel({ map, city }: { map: any; city: BvpCity }) {
  const base = `/__debug/geometry/bvp/${city}`;
  const label = city === 'beijing' ? '北京' : '锦州';
  const [index, setIndex] = useState<JinLine[]>([]);
  const [query, setQuery] = useState('');
  const [geomIndex, setGeomIndex] = useState<CityGeometryIndex | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [status, setStatus] = useState(`加载${label}实验包…`);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ line: JinLine; original: GeoPath; decoded: GeoPath; stat: DevStat; singleMs: number } | null>(null);
  const [initMs, setInitMs] = useState<{ index: number; decodeAll: number; bytes: number } | null>(null);
  const [show, setShow] = useState({ original: true, decoded: true });
  const [verify, setVerify] = useState<any>(null);
  const [bvpk, setBvpk] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [shard, setShard] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const overlays = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus(`加载${label}索引与二进制几何…`);
        const idxRes = await fetch(`${base}/index`); const idxJson = await idxRes.json();
        if (!idxRes.ok) throw new Error(idxJson.error || '索引加载失败');
        if (cancelled) return; setIndex(idxJson.lines);
        const [bvpBuf, infoJson] = await Promise.all([
          fetch(`${base}/file?name=paths.bvp`).then((r) => r.arrayBuffer()),
          fetch(`${base}/info`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const bytes = bvpBuf.byteLength; const t0 = performance.now(); const gidx = indexCityGeometry(new Uint8Array(bvpBuf)); const indexMs = performance.now() - t0;
        const t1 = performance.now(); for (let i = 0; i < gidx.spans.length; i++) decodeRoute(gidx, i); const decodeAll = performance.now() - t1;
        setGeomIndex(gidx); setInfo(infoJson); setInitMs({ index: indexMs, decodeAll, bytes }); setStatus('');
      } catch (e: any) { if (!cancelled) { setError(String(e.message || e)); setStatus(''); } }
    })();
    return () => { cancelled = true; clearOverlays(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  function clearOverlays() { for (const o of overlays.current) { try { map?.remove(o); } catch { /* ignore */ } } overlays.current = []; }
  function setVis(poly: any, v: boolean) { if (!poly) return; if (typeof poly.setVisible === 'function') poly.setVisible(v); else if (v) poly.show?.(); else poly.hide?.(); }
  function draw(original: GeoPath, decoded: GeoPath) {
    const AMap = (window as any).AMap; if (!AMap || !map) return; clearOverlays();
    if (original.length > 1) { const p = new AMap.Polyline({ path: original, strokeColor: '#ff3b30', strokeWeight: 5, strokeOpacity: 0.85 }); map.add(p); overlays.current.push(p); setVis(p, show.original); }
    if (decoded.length > 1) { const p = new AMap.Polyline({ path: decoded, strokeColor: '#0a84ff', strokeWeight: 3, strokeOpacity: 0.9 }); map.add(p); overlays.current.push(p); setVis(p, show.decoded); }
    try { map.setFitView(overlays.current, false, [60, 60, 60, 60]); } catch { /* ignore */ }
  }

  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); const list = q ? index.filter((l) => l.name.toLowerCase().includes(q) || l.id.includes(q)) : index; return list.slice(0, 120); }, [index, query]);

  async function selectLine(line: JinLine) {
    if (!geomIndex) return; setError('');
    try {
      const t = performance.now(); const decoded = decodeRoute(geomIndex, line.routeIndex); const singleMs = performance.now() - t;
      const origRes = await fetch(`${base}/original-line?routeIndex=${line.routeIndex}`); const orig = await origRes.json();
      if (orig.error) throw new Error(orig.error);
      const stat = pointwise(orig.path, decoded);
      setSelected({ line, original: orig.path, decoded, stat, singleMs }); draw(orig.path, decoded);
    } catch (e: any) { setError(String(e.message || e)); }
  }

  function toggle(key: 'original' | 'decoded', v: boolean) { setShow((s) => ({ ...s, [key]: v })); setVis(overlays.current[key === 'original' ? 0 : 1], v); }
  function locate() { if (!selected || !map) return; try { map.setZoomAndCenter(16, selected.stat.maxPoint || selected.original[0]); } catch { /* ignore */ } }

  async function runVerify() {
    if (!geomIndex) return; setBusy('verify'); setVerify(null);
    try {
      const restoredText = await fetch(`${base}/file?name=restored.json`).then((r) => r.text());
      const restored = JSON.parse(restoredText); const meta = restored.lines as any[];
      if (meta.length !== geomIndex.spans.length) throw new Error(`线路数不一致 ${meta.length} vs ${geomIndex.spans.length}`);
      let points = 0, coordMismatch = 0, lenMismatch = 0, missing = 0; const anomalies: number[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < geomIndex.spans.length; i++) {
        if (seen.has(i)) anomalies.push(i); seen.add(i);
        const dec = decodeRoute(geomIndex, i); const orig = meta[i]?.path || [];
        if (!orig.length || dec.length === 0) { missing++; anomalies.push(i); continue; }
        if (dec.length !== orig.length) { lenMismatch++; anomalies.push(i); }
        const n = Math.min(dec.length, orig.length);
        for (let j = 0; j < n; j++) { if (dec[j][0] !== orig[j][0] || dec[j][1] !== orig[j][1]) coordMismatch++; points++; }
      }
      setVerify({ routes: geomIndex.spans.length, points, coordMismatch, lenMismatch, missing, anomalies: anomalies.slice(0, 50), pass: coordMismatch === 0 && lenMismatch === 0 && missing === 0 });
    } catch (e: any) { setError(`全市校验失败：${e.message || e}`); } finally { setBusy(''); }
  }

  async function runBvpk() {
    setBusy('bvpk'); setBvpk(null); setError('');
    try {
      const container = await fetchBytes(`${base}/bvpk`);
      const header = parseBvpkHeader(container);
      if (!header.valid) throw new Error(`BVPK1 头/长度无效 magic=${header.magic}`);
      const t0 = performance.now();
      const meta = await fetch(`${base}/bvpk-block?which=meta`).then((r) => r.json()); // 浏览器原生 Brotli 解压
      const geom = await fetchBytes(`${base}/bvpk-block?which=geom`); // 浏览器原生 Brotli 解压
      const tDecomp = performance.now() - t0;
      const gidx = indexCityGeometry(geom); const consistent = meta.lines.length === gidx.spans.length;
      const t1 = performance.now(); let pts = 0; for (let i = 0; i < gidx.spans.length; i++) pts += decodeRoute(gidx, i).length; const decodeMs = performance.now() - t1;
      setBvpk({ header, metaLines: meta.lines.length, spans: gidx.spans.length, consistent, geomBytes: geom.length, points: pts, tDecomp, decodeMs });
    } catch (e: any) { setBvpk({ failed: true }); setError(`BVPK1 失败（回退原始）：${e.message || e}`); } finally { setBusy(''); }
  }

  async function runPerf() {
    if (!geomIndex) return; setBusy('perf'); setPerf(null);
    try {
      const ITER = 10;
      const jsonTimes: number[] = [], decodeAll: number[] = [], single: number[] = [];
      const restoredText = await fetch(`${base}/file?name=restored.json`).then((r) => r.text());
      for (let k = 0; k < ITER; k++) { const t = performance.now(); JSON.parse(restoredText); jsonTimes.push(performance.now() - t); }
      for (let k = 0; k < ITER; k++) { const t = performance.now(); for (let i = 0; i < geomIndex.spans.length; i++) decodeRoute(geomIndex, i); decodeAll.push(performance.now() - t); }
      for (let k = 0; k < ITER; k++) { const t = performance.now(); decodeRoute(geomIndex, k % geomIndex.spans.length); single.push(performance.now() - t); }
      setPerf({ iter: ITER, jsonParse: { median: median(jsonTimes), p95: p95of(jsonTimes) }, decodeAll: { median: median(decodeAll), p95: p95of(decodeAll) }, single: { median: median(single), p95: p95of(single) }, memMB: memMB() });
    } catch (e: any) { setError(String(e)); } finally { setBusy(''); }
  }

  async function runShard() {
    if (!geomIndex) return; setBusy('shard'); setShard(null);
    try {
      const si = await fetch(`${base}/shard-info`).then((r) => r.json());
      const idx = selected ? selected.line.routeIndex : 0; const shardIdx = si.routeToShard[idx];
      // A: 整包（未压缩 bvp 字节）
      const tA = performance.now(); const whole = await fetchBytes(`${base}/file?name=paths.bvp`); const wholeIdx = indexCityGeometry(whole); decodeRoute(wholeIdx, idx); const msA = performance.now() - tA;
      // B: 只取包含该线路的分片（浏览器原生 Brotli 解压）
      const tB = performance.now(); const shardBytes = await fetchBytes(`${base}/shard/${shardIdx}`); const sIdx = indexCityGeometry(shardBytes);
      const local = sIdx.spans.length ? 0 : 0; decodeRoute(sIdx, local); const msB = performance.now() - tB;
      const shardWire = (await fetch(`${base}/shard/${shardIdx}`, { method: 'HEAD' }).then((r) => Number(r.headers.get('X-Shard-Raw-Bytes') || 0)).catch(() => 0));
      setShard({ shardCount: si.shardCount, shardIdx, wholeRawBytes: whole.length, shardRawBytes: si.shardRawSizes[shardIdx], wholeBrBytes: si.wholeBrBytes, msA, msB, shardWire });
    } catch (e: any) { setError(String(e)); } finally { setBusy(''); }
  }

  return (
    <div className="space-y-2">
      {status && <p className="text-sky-300">{status}</p>}
      {error && <p className="text-amber-400 whitespace-pre-wrap">{error}</p>}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`按线路名称或 ID 搜索（${label} ${index.length} 条）…`}
        className="w-full rounded-lg bg-slate-800 px-2 py-1.5 outline-none border border-slate-600 focus:border-sky-400" />
      <p className="text-[10px] text-slate-500">每条记录即一个方向（A--B）；选另一方向即切换上下行。</p>
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={show.original} onChange={(e) => toggle('original', e.target.checked)} /><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ff3b30' }} />原始</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={show.decoded} onChange={(e) => toggle('decoded', e.target.checked)} /><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#0a84ff' }} />BVP1解码</label>
      </div>
      {initMs && <p className="text-[10px] text-slate-500">init: index {ms(initMs.index)}ms · 全{index.length}解码 {ms(initMs.decodeAll)}ms · bvp {fmt(initMs.bytes)}B</p>}
      {!selected && (
        <div className="max-h-[38vh] overflow-auto border border-slate-700 rounded-lg divide-y divide-slate-800">
          {filtered.map((l) => (<button key={l.id} onClick={() => selectLine(l)} className="block w-full text-left px-2 py-1 hover:bg-slate-800"><span className="font-bold text-sky-300">{l.id}</span> · {l.name}</button>))}
          {!filtered.length && <p className="p-2 text-slate-500">无匹配线路</p>}
        </div>
      )}
      {selected && (
        <div className="space-y-1">
          <button onClick={() => { setSelected(null); clearOverlays(); }} className="text-sky-300 underline">← 返回列表</button>
          <p className="font-bold">{selected.line.name}</p>
          <p className="text-slate-400">{selected.line.id} · {selected.line.startStop} → {selected.line.endStop}</p>
          <div className="rounded-lg bg-slate-800 p-2 space-y-1">
            <p>点数: 原始 {selected.original.length} / 解码 {selected.decoded.length} · {selected.stat.lengthsEqual ? '一致' : '不一致'}</p>
            <p>逐点经纬度: {selected.stat.mismatch === 0 ? '完全一致（0 处差异）' : `${selected.stat.mismatch} 处差异`}</p>
            <p className="tabular-nums">偏差(米): max {selected.stat.max.toFixed(3)} · avg {selected.stat.avg.toFixed(3)} · p95 {selected.stat.p95.toFixed(3)}</p>
            <p className="text-[10px] text-slate-400">单线解码 {ms(selected.singleMs)}ms</p>
            <button onClick={locate} className="text-sky-300 underline">定位（最大偏差点）</button>
          </div>
        </div>
      )}
      <details className="rounded-lg bg-slate-800 p-2"><summary className="font-bold text-slate-300 cursor-pointer">全市无损校验（{index.length} 条）</summary>
        <button onClick={runVerify} disabled={!!busy} className="mt-2 px-2 py-1 rounded bg-sky-600 text-white disabled:opacity-40">{busy === 'verify' ? '校验中…' : '解码全部并逐点比对原始'}</button>
        {verify && <div className="mt-1 space-y-0.5 text-slate-300">
          <p>线路 {verify.routes} · 比对点数 {fmt(verify.points)}</p>
          <p>坐标不一致 {verify.coordMismatch} · 长度不一致 {verify.lenMismatch} · 缺失 {verify.missing} · 重复/异常 {verify.anomalies.length}</p>
          <p className={verify.pass ? 'text-emerald-400' : 'text-red-400'}>{verify.pass ? '通过：全部点逐位一致，0 米误差' : '未通过'}</p>
          {verify.anomalies.length > 0 && <p className="text-[10px] text-amber-400">异常线路索引: {verify.anomalies.join(',')}</p>}
        </div>}
      </details>
      <details className="rounded-lg bg-slate-800 p-2"><summary className="font-bold text-slate-300 cursor-pointer">BVPK1 容器（浏览器解压+解码）</summary>
        <button onClick={runBvpk} disabled={!!busy} className="mt-2 px-2 py-1 rounded bg-sky-600 text-white disabled:opacity-40">{busy === 'bvpk' ? '测试中…' : '请求 city.bvpk → 浏览器 Brotli 解压 → TS 解码'}</button>
        {bvpk && !bvpk.failed && <div className="mt-1 text-slate-300 space-y-0.5">
          <p>头: {bvpk.header.magic} meta {bvpk.header.metaLength}B · geom {bvpk.header.geomLength}B · valid {String(bvpk.header.valid)}</p>
          <p>解压后几何 {fmt(bvpk.geomBytes)}B · 元数据线路 {bvpk.metaLines} / 几何线路 {bvpk.spans} · {bvpk.consistent ? '一致 ✓' : '不一致 ✗'}</p>
          <p>浏览器 Brotli 解压耗时 {ms(bvpk.tDecomp)}ms · 解全部 {fmt(bvpk.points)} 点 {ms(bvpk.decodeMs)}ms</p>
          <p className="text-[10px] text-slate-500">Brotli 由浏览器原生 Content-Encoding 解压；几何由浏览器真实 TS 解码。</p>
        </div>}
      </details>
      <details className="rounded-lg bg-slate-800 p-2"><summary className="font-bold text-slate-300 cursor-pointer">性能基准（10 次，中位数/P95）</summary>
        <button onClick={runPerf} disabled={!!busy} className="mt-2 px-2 py-1 rounded bg-sky-600 text-white disabled:opacity-40">{busy === 'perf' ? '运行中…' : '运行 10 次基准'}</button>
        {perf && <div className="mt-1 text-slate-300 space-y-0.5">
          <p>JSON.parse(还原 {fmt((info?.sizes?.['restored.json']) || 0)}B): median {ms(perf.jsonParse.median)} / p95 {ms(perf.jsonParse.p95)} ms</p>
          <p>BVP1 全{index.length}解码: median {ms(perf.decodeAll.median)} / p95 {ms(perf.decodeAll.p95)} ms</p>
          <p>单线解码: median {ms(perf.single.median)} / p95 {ms(perf.single.p95)} ms</p>
          <p>JS堆: {perf.memMB >= 0 ? `${perf.memMB} MB` : '不可用'}</p>
          <p className="text-[10px] text-slate-500">原始JSON {fmt(info?.sizes?.['restored.json'] || 0)}B · city.bvpk {fmt(info?.sizes?.['city.bvpk'] || 0)}B · 几何br {fmt(info?.sizes?.['paths.bvp.br'] || 0)}B</p>
        </div>}
      </details>
      <details className="rounded-lg bg-slate-800 p-2"><summary className="font-bold text-slate-300 cursor-pointer">分片实验 A(整包) vs B(单分片)</summary>
        <button onClick={runShard} disabled={!!busy} className="mt-2 px-2 py-1 rounded bg-sky-600 text-white disabled:opacity-40">{busy === 'shard' ? '对比中…' : '对比整包 vs 分片（基于当前选中线路）'}</button>
        {shard && <div className="mt-1 text-slate-300 space-y-0.5">
          <p>分片数 {shard.shardCount} · 命中分片 #{shard.shardIdx}</p>
          <p>A 整包(未压缩 bvp): {fmt(shard.wholeRawBytes)}B · 解全部+取 1 线 {ms(shard.msA)}ms</p>
          <p>B 单分片(原始): {fmt(shard.shardRawBytes || 0)}B · 仅解该分片 {ms(shard.msB)}ms</p>
          <p className="text-[10px] text-slate-500">说明：整市为单一 Brotli 块，随机读取需分片；分片用独立 brotli 块，仅请求所需部分。</p>
        </div>}
      </details>
    </div>
  );
}
