import { handleCityDataRequest } from './src/server/cityData';
import { runBuslineAI } from './src/server/buslineAI';
import fs from 'fs';
import path from 'path';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { decodeDeltaE6, encodeDirections, decodeDirections, rdpSimplify, deviationStats, encodeVarintDelta, pathLengthMeters, type Point } from './src/utils/geometryEncoding';

// Conversions for Firestore REST API JSON structure
function fromFirestore(doc: any): any {
  if (!doc) return null;
  const result: any = {};
  const fields = doc.fields || {};
  for (const [key, valObj] of Object.entries(fields)) {
    result[key] = readValue(valObj);
  }
  return result;
}

function readValue(valObj: any): any {
  if (!valObj) return null;
  if ('stringValue' in valObj) return valObj.stringValue;
  if ('integerValue' in valObj) return parseInt(valObj.integerValue, 10);
  if ('doubleValue' in valObj) return parseFloat(valObj.doubleValue);
  if ('booleanValue' in valObj) return valObj.booleanValue;
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue.values || [];
    return values.map((v: any) => readValue(v));
  }
  if ('mapValue' in valObj) {
    const fields = valObj.mapValue.fields || {};
    const res: any = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = readValue(v);
    }
    return res;
  }
  return null;
}

function toFirestore(obj: any): any {
  const fields: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const fVal = toValue(value);
    if (fVal !== undefined) {
      fields[key] = fVal;
    }
  }
  return { fields };
}

function toValue(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toValue).filter((v: any) => v !== undefined)
      }
    };
  }
  if (typeof value === 'object') {
    const fields: any = {};
    for (const [k, v] of Object.entries(value)) {
      const fv = toValue(v);
      if (fv !== undefined) fields[k] = fv;
    }
    return {
      mapValue: { fields }
    };
  }
  return undefined;
}

// ---- 线路几何压缩对比：仅开发环境（configureServer 仅在 dev 运行）----
const GEOMETRY_DEBUG_DIR = process.env.GEOMETRY_DEBUG_DIR || path.join(process.cwd(), '.geometry-experiment');
type GeometryCache = { key: string; index: any[]; rawById: Map<string, Point[]>; deltaById: Map<string, any> };
let geometryCache: GeometryCache | null = null;

function loadGeometry(): GeometryCache | null {
  const rawPath = path.join(GEOMETRY_DEBUG_DIR, 'raw.json');
  const deltaPath = path.join(GEOMETRY_DEBUG_DIR, 'delta.json');
  if (!fs.existsSync(rawPath) || !fs.existsSync(deltaPath)) return null;
  const key = `${fs.statSync(rawPath).mtimeMs}:${fs.statSync(deltaPath).mtimeMs}`;
  if (geometryCache && geometryCache.key === key) return geometryCache;
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'));
  const rawById = new Map<string, Point[]>(raw.lines.map((line: any) => [line.id, line.path]));
  const deltaById = new Map<string, any>(delta.lines.map((line: any) => [line.id, line.path]));
  const index = delta.lines.map((line: any) => ({
    id: line.id, name: line.name, startStop: line.start_stop || '', endStop: line.end_stop || '',
    points: 1 + (line.path?.deltas?.length || 0) / 2, hasRaw: rawById.has(line.id),
  }));
  geometryCache = { key, index, rawById, deltaById };
  return geometryCache;
}

// ---- BVP1/BVPK1 实验数据（锦州/北京）：仅开发环境；原始文件只读；几何由浏览器真实 TS 解码；Brotli 走浏览器原生 Content-Encoding ----
const BVP_CITIES: Record<string, string> = {
  jinzhou: path.join(process.cwd(), '.geometry-experiment/jinzhou/outputs'),
  beijing: path.join(process.cwd(), '.geometry-experiment/beijing/package/outputs'),
};
const BVP_FILES: Record<string, string> = {
  'meta.json': 'city.meta.json', 'paths.bvp': 'city.paths.bvp', 'city.bvpk': 'city.bvpk',
  'restored.json': 'city.restored.json', 'paths.bvp.br': 'city.paths.bvp.br', 'meta.json.br': 'city.meta.json.br',
};
const bvpMetaCache = new Map<string, { key: string; meta: any }>();
function bvpDir(city: string): string | null { return BVP_CITIES[city] || null; }
function bvpRead(city: string, name: string): Buffer | null {
  const dir = bvpDir(city); const file = BVP_FILES[name]; if (!dir || !file) return null;
  const p = path.join(dir, file); return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function loadBvpMeta(city: string): any | null {
  const dir = bvpDir(city); if (!dir) return null;
  const filePath = path.join(dir, BVP_FILES['meta.json']); if (!fs.existsSync(filePath)) return null;
  const key = String(fs.statSync(filePath).mtimeMs); const c = bvpMetaCache.get(city);
  if (c && c.key === key) return c.meta;
  const meta = JSON.parse(fs.readFileSync(filePath, 'utf8')); bvpMetaCache.set(city, { key, meta }); return meta;
}
const bvpRestoredCache = new Map<string, { key: string; lines: any[] }>();
function loadBvpRestored(city: string): any[] | null {
  const dir = bvpDir(city); if (!dir) return null;
  const fp = path.join(dir, BVP_FILES['restored.json']); if (!fs.existsSync(fp)) return null;
  const key = String(fs.statSync(fp).mtimeMs); const c = bvpRestoredCache.get(city); if (c && c.key === key) return c.lines;
  const lines = JSON.parse(fs.readFileSync(fp, 'utf8')).lines; bvpRestoredCache.set(city, { key, lines }); return lines;
}
function readVarint(buf: Buffer, start: number): [number, number] { let n = 0, shift = 1, p = start; for (;;) { const b = buf[p++]; n += (b & 127) * shift; if (!(b & 128)) return [n, p]; shift *= 128; } }
function putVarint(n: number): number[] { const out: number[] = []; do { let b = n % 128; n = Math.floor(n / 128); out.push(n > 0 ? b + 128 : b); } while (n > 0); return out; }
type BvpSharding = { shardCount: number; routeToShard: number[]; shardRawSizes: number[]; shardsBr: Buffer[] };
const bvpShardCache = new Map<string, BvpSharding>();
function buildSharding(city: string): BvpSharding | null {
  const cached = bvpShardCache.get(city); if (cached) return cached;
  const bvp = bvpRead(city, 'paths.bvp'); if (!bvp || bvp.subarray(0, 4).toString('latin1') !== 'BVP1') return null;
  let p = 4; const [count, afterCount] = readVarint(bvp, p); p = afterCount;
  const lengths: number[] = []; for (let i = 0; i < count; i++) { const [len, np] = readVarint(bvp, p); lengths.push(len); p = np; }
  const frames: Buffer[] = []; for (const len of lengths) { frames.push(bvp.subarray(p, p + len)); p += len; }
  const K = Math.min(16, count || 1); const routeToShard: number[] = []; const groups: Buffer[][] = Array.from({ length: K }, () => []);
  for (let i = 0; i < count; i++) { const s = Math.min(K - 1, Math.floor((i * K) / (count || 1))); routeToShard.push(s); groups[s].push(frames[i]); }
  const shardsBr: Buffer[] = []; const shardRawSizes: number[] = [];
  for (let s = 0; s < K; s++) {
    const g = groups[s]; const parts: Buffer[] = [Buffer.from('BVP1', 'latin1'), Buffer.from(putVarint(g.length))];
    for (const f of g) parts.push(Buffer.from(putVarint(f.length)));
    for (const f of g) parts.push(f);
    const blob = Buffer.concat(parts); shardRawSizes.push(blob.length); shardsBr.push(brotliCompressSync(blob));
  }
  const result: BvpSharding = { shardCount: K, routeToShard, shardRawSizes, shardsBr };
  bvpShardCache.set(city, result); return result;
}
function handleBvp(city: string, rest: string, search: URLSearchParams, res: any): void {
  if (!bvpDir(city)) { res.statusCode = 404; res.end(JSON.stringify({ error: `未知城市 ${city}` })); return; }
  if (rest === 'file') { const name = search.get('name') || ''; const bytes = bvpRead(city, name); if (!bytes) { res.statusCode = 404; res.end(JSON.stringify({ error: `缺少实验文件：${name}` })); return; } res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json;charset=utf-8' : 'application/octet-stream'); res.end(bytes); return; }
  if (rest === 'index') { const meta = loadBvpMeta(city); if (!meta) { res.statusCode = 503; res.end(JSON.stringify({ error: '缺少实验包（city.meta.json）' })); return; } res.end(JSON.stringify({ lines: meta.lines.map((l: any, i: number) => ({ routeIndex: i, id: l.id, name: l.name, startStop: l.start_stop || '', endStop: l.end_stop || '' })) })); return; }
  if (rest === 'original-line') {
    const idx = Number(search.get('routeIndex')); const lines = loadBvpRestored(city);
    if (!lines || !Number.isInteger(idx) || idx < 0 || idx >= lines.length) { res.statusCode = 404; res.end(JSON.stringify({ error: '线路不存在' })); return; }
    const l = lines[idx]; res.end(JSON.stringify({ id: l.id, name: l.name, startStop: l.start_stop, endStop: l.end_stop, stops: Array.isArray(l.via_stops) ? l.via_stops.length : 0, path: l.path })); return;
  }
  if (rest === 'info') {
    const sizes: Record<string, number> = {}; for (const name of Object.keys(BVP_FILES)) { const b = bvpRead(city, name); if (b) sizes[name] = b.length; }
    let metaBrotliMs = 0, geomBrotliMs = 0, bvpk: any = null;
    const metaBr = bvpRead(city, 'meta.json.br'), geomBr = bvpRead(city, 'paths.bvp.br');
    if (metaBr) { const t = performance.now(); brotliDecompressSync(metaBr); metaBrotliMs = performance.now() - t; }
    if (geomBr) { const t = performance.now(); brotliDecompressSync(geomBr); geomBrotliMs = performance.now() - t; }
    const bvpkBytes = bvpRead(city, 'city.bvpk');
    if (bvpkBytes) { const magic = bvpkBytes.subarray(0, 5).toString('latin1'); const metaLen = bvpkBytes.readUInt32LE(5), geomLen = bvpkBytes.readUInt32LE(9); bvpk = { magic, metaLength: metaLen, geomLength: geomLen, totalLength: bvpkBytes.length, valid: magic === 'BVPK1' && 13 + metaLen + geomLen === bvpkBytes.length }; }
    res.end(JSON.stringify({ sizes, metaBrotliMs, geomBrotliMs, bvpk, note: 'Brotli 计时为 Node 侧参考' })); return;
  }
  if (rest === 'bvpk') { const bytes = bvpRead(city, 'city.bvpk'); if (!bytes) { res.statusCode = 404; res.end(JSON.stringify({ error: '缺少 city.bvpk' })); return; } res.setHeader('Content-Type', 'application/octet-stream'); res.end(bytes); return; }
  if (rest === 'bvpk-block') {
    const which = search.get('which') || 'geom'; const bytes = bvpRead(city, 'city.bvpk');
    if (!bytes) { res.statusCode = 404; res.end(JSON.stringify({ error: '缺少 city.bvpk' })); return; }
    const magic = bytes.subarray(0, 5).toString('latin1'); const metaLen = bytes.length >= 13 ? bytes.readUInt32LE(5) : 0, geomLen = bytes.length >= 13 ? bytes.readUInt32LE(9) : 0;
    if (magic !== 'BVPK1' || 13 + metaLen + geomLen !== bytes.length) { res.statusCode = 400; res.end(JSON.stringify({ error: 'BVPK1 容器无效' })); return; }
    const block = which === 'meta' ? bytes.subarray(13, 13 + metaLen) : bytes.subarray(13 + metaLen, 13 + metaLen + geomLen);
    res.setHeader('Content-Type', which === 'meta' ? 'application/json;charset=utf-8' : 'application/octet-stream');
    res.setHeader('Content-Encoding', 'br'); res.setHeader('X-Block-Compressed-Bytes', String(block.length)); res.end(block); return;
  }
  if (rest === 'shard-info') { const s = buildSharding(city); if (!s) { res.statusCode = 503; res.end(JSON.stringify({ error: '缺少 city.paths.bvp' })); return; } const whole = bvpRead(city, 'paths.bvp.br'); res.end(JSON.stringify({ shardCount: s.shardCount, routeToShard: s.routeToShard, shardRawSizes: s.shardRawSizes, wholeBrBytes: whole ? whole.length : 0 })); return; }
  if (rest.startsWith('shard/')) {
    const idx = Number(rest.slice('shard/'.length).replace(/\.br$/, '')); const s = buildSharding(city);
    if (!s || !Number.isInteger(idx) || idx < 0 || idx >= s.shardCount) { res.statusCode = 404; res.end(JSON.stringify({ error: '分片不存在' })); return; }
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Encoding', 'br'); res.setHeader('X-Shard-Raw-Bytes', String(s.shardRawSizes[idx])); res.end(s.shardsBr[idx]); return;
  }
  res.statusCode = 404; res.end(JSON.stringify({ error: '没有这个 BVP 几何接口。' }));
}

function handleGeometryDebug(pathname: string, search: URLSearchParams, res: any): void {
  if (pathname.startsWith('/__debug/geometry/bvp/')) {
    const sub = pathname.slice('/__debug/geometry/bvp/'.length);
    const slash = sub.indexOf('/');
    const city = slash < 0 ? sub : sub.slice(0, slash);
    const rest = slash < 0 ? '' : sub.slice(slash + 1);
    handleBvp(decodeURIComponent(city), rest, search, res); return;
  }
  const data = loadGeometry();
  if (!data) { res.statusCode = 503; res.end(JSON.stringify({ error: '实验数据不存在：请把 raw.json / delta.json 放到 .geometry-experiment/' })); return; }
  if (pathname === '/__debug/geometry/index') { res.end(JSON.stringify({ lines: data.index })); return; }
  if (pathname === '/__debug/geometry/line') {
    const id = search.get('id') || '';
    const original = data.rawById.get(id), deltaPath = data.deltaById.get(id);
    if (!original || !deltaPath) { res.statusCode = 404; res.end(JSON.stringify({ error: '未找到该线路' })); return; }
    const epsilon = Math.max(0.5, Number(search.get('eps')) || 10);
    const deltaRestored = decodeDeltaE6(deltaPath);
    const direction720 = decodeDirections(encodeDirections(original));
    const rdp = rdpSimplify(original, epsilon);
    const varintBytes = encodeVarintDelta(deltaPath);
    const brotliBytes = brotliCompressSync(Buffer.from(varintBytes));
    const bounds = original.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    const line = data.index.find((item: any) => item.id === id);
    res.end(JSON.stringify({
      id, name: line?.name, startStop: line?.startStop, endStop: line?.endStop, bounds, epsilon,
      layers: { original, deltaRestored, direction720, rdp },
      stats: { delta: deviationStats(original, deltaRestored), direction720: deviationStats(original, direction720), rdp: deviationStats(original, rdp) },
      sizes: { points: original.length, rawJson: JSON.stringify(original).length, deltaJson: JSON.stringify(deltaPath).length, varint: varintBytes.length, brotli: brotliBytes.length, rdpPoints: rdp.length, lengthMeters: Math.round(pathLengthMeters(original)) },
    }));
    return;
  }
  res.statusCode = 404; res.end(JSON.stringify({ error: '没有这个几何调试接口。' }));
}

export function viteApiPlugin() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const PENDING_DIR = path.join(DATA_DIR, 'pending');
  const APPROVED_DIR = path.join(DATA_DIR, 'approved');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
  if (!fs.existsSync(APPROVED_DIR)) fs.mkdirSync(APPROVED_DIR, { recursive: true });

  let firebaseEnabled = false;
  let firebaseBaseUrl = '';
  let firebaseApiKey = '';

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config && config.apiKey && config.apiKey.trim() !== "") {
        const isCustomDb = config.firestoreDatabaseId && config.firestoreDatabaseId.trim() !== '';
        const databaseId = isCustomDb ? config.firestoreDatabaseId : '(default)';
        firebaseBaseUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${databaseId}/documents`;
        firebaseApiKey = config.apiKey;
        firebaseEnabled = true;
      }
    }
  } catch (e) {
    console.error("Vite API Plugin failed to load firebase config:", e);
  }

  const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_\-]/g, '');

  return {
    name: 'vite-api-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const urlStr = req.url || '';
        if (urlStr.startsWith('/__debug/geometry/')) {
          const geometryUrl = new URL(urlStr, 'http://localhost');
          res.setHeader('Content-Type', 'application/json');
          return handleGeometryDebug(geometryUrl.pathname, geometryUrl.searchParams, res);
        }
        if (!urlStr.startsWith('/api/')) {
          return next();
        }

        const parsedUrl = new URL(urlStr, 'http://localhost');
        const pathname = parsedUrl.pathname;
        const method = req.method;

        res.setHeader('Content-Type', 'application/json');

        // Helper to parse body
        const parseBody = (): Promise<any> => {
          return new Promise((resolve) => {
            let bodyStr = '';
            req.on('data', (chunk: any) => {
              bodyStr += chunk;
            });
            req.on('end', () => {
              try {
                resolve(JSON.parse(bodyStr));
              } catch (e) {
                resolve({});
              }
            });
          });
        };

        try {
          if (pathname.startsWith('/api/city-data/')) {
            const result = await handleCityDataRequest(method, pathname, method === 'POST' ? await parseBody() : undefined, String(req.headers['x-admin-password'] || ''), String(req.headers['x-city-refresh-token'] || ''));
            res.statusCode = result.status;
            res.end(JSON.stringify(result.body));
            return;
          }
          if (pathname === '/api/ai/chat' && method === 'POST') {
            try { res.end(JSON.stringify(await runBuslineAI(await parseBody()))); }
            catch (error: any) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message || 'Busline AI 暂时不可用。' })); }
            return;
          }
          if (pathname === '/api/health') {
            res.end(JSON.stringify({ status: 'ok', firebaseProxyActive: firebaseEnabled }));
            return;
          }

          if (pathname === '/api/submissions/submit' && method === 'POST') {
            const body = await parseBody();
            const { id, name, creatorNickname, city, district, path: linePath, via_stops, status, timestamp } = body;
            if (!id || !name || !creatorNickname || !city) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing required fields' }));
              return;
            }

            const fileId = sanitizeId(id);
            const data = {
              id: fileId,
              name,
              creatorNickname,
              city,
              district: district || '',
              path: linePath || [],
              via_stops: via_stops || [],
              status: status || 'pending',
              timestamp: timestamp || Date.now()
            };

            if (firebaseEnabled) {
              const firestoreDoc = toFirestore(data);
              const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
              const fRes = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(firestoreDoc)
              });
              if (!fRes.ok) {
                const rawErr = await fRes.text();
                let parsedErr: any = {};
                try { parsedErr = JSON.parse(rawErr); } catch(ex){}
                const innerMessage = parsedErr?.error?.message || rawErr;
                throw new Error(`Firebase 存储失败 (${fRes.status}): ${innerMessage}`);
              }
            } else {
              const filePath = path.join(PENDING_DIR, `${fileId}.json`);
              fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            }

            res.end(JSON.stringify({ success: true, message: 'Submitted successfully' }));
            return;
          }

          if (pathname === '/api/submissions/status') {
            const idsStr = parsedUrl.searchParams.get('ids');
            if (!idsStr) {
              res.end(JSON.stringify({}));
              return;
            }

            const ids = idsStr.split(',').map(sanitizeId);
            const statuses: Record<string, string> = {};

            if (firebaseEnabled && ids.length > 0) {
              await Promise.all(
                ids.map(async (fileId) => {
                  try {
                    const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
                    const fRes = await fetch(url);
                    if (fRes.ok) {
                      const docSnap = await fRes.json();
                      const simpleObj = fromFirestore(docSnap);
                      statuses[fileId] = simpleObj.status || 'pending';
                    } else if (fRes.status === 404) {
                      statuses[fileId] = 'rejected';
                    } else {
                      statuses[fileId] = 'pending';
                    }
                  } catch (err) {
                    statuses[fileId] = 'pending';
                  }
                })
              );
              res.end(JSON.stringify(statuses));
              return;
            }

            // Local fallback
            ids.forEach(id => {
              const approvedPath = path.join(APPROVED_DIR, `${id}.json`);
              const pendingPath = path.join(PENDING_DIR, `${id}.json`);

              if (fs.existsSync(approvedPath)) {
                statuses[id] = 'approved';
              } else if (fs.existsSync(pendingPath)) {
                statuses[id] = 'pending';
              } else {
                statuses[id] = 'rejected';
              }
            });

            res.end(JSON.stringify(statuses));
            return;
          }

          if (pathname === '/api/submissions/approved') {
            if (firebaseEnabled) {
              const url = `${firebaseBaseUrl}/submissions?pageSize=1000&key=${firebaseApiKey}`;
              const fRes = await fetch(url);
              if (!fRes.ok) {
                const rawErr = await fRes.text();
                throw new Error(`Firebase 同步失败 (${fRes.status}): ${rawErr}`);
              }
              const result = await fRes.json();
              const docs = result.documents || [];
              const lines = docs
                .map(fromFirestore)
                .filter((line: any) => line && line.status === 'approved')
                .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
              res.end(JSON.stringify(lines));
              return;
            }

            // Local fallback
            if (!fs.existsSync(APPROVED_DIR)) {
              res.end(JSON.stringify([]));
              return;
            }
            const files = fs.readdirSync(APPROVED_DIR);
            const lines = files
              .filter(f => f.endsWith('.json'))
              .map(f => {
                try {
                  return JSON.parse(fs.readFileSync(path.join(APPROVED_DIR, f), 'utf-8'));
                } catch (e) {
                  return null;
                }
              })
              .filter(Boolean);

            res.end(JSON.stringify(lines));
            return;
          }

          if (pathname === '/api/admin/pending') {
            if (firebaseEnabled) {
              const url = `${firebaseBaseUrl}/submissions?pageSize=1000&key=${firebaseApiKey}`;
              const fRes = await fetch(url);
              if (!fRes.ok) {
                const rawErr = await fRes.text();
                throw new Error(`Firebase 同步失败 (${fRes.status}): ${rawErr}`);
              }
              const result = await fRes.json();
              const docs = result.documents || [];
              const lines = docs
                .map(fromFirestore)
                .filter((line: any) => line && line.status === 'pending')
                .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
              res.end(JSON.stringify(lines));
              return;
            }

            // Local fallback
            if (!fs.existsSync(PENDING_DIR)) {
              res.end(JSON.stringify([]));
              return;
            }
            const files = fs.readdirSync(PENDING_DIR);
            const lines = files
              .filter(f => f.endsWith('.json'))
              .map(f => {
                try {
                  return JSON.parse(fs.readFileSync(path.join(PENDING_DIR, f), 'utf-8'));
                } catch (e) {
                  return null;
                }
              })
              .filter(Boolean);

            res.end(JSON.stringify(lines));
            return;
          }

          if (pathname === '/api/admin/approve' && method === 'POST') {
            const body = await parseBody();
            const { id } = body;
            if (!id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing Id' }));
              return;
            }

            const fileId = sanitizeId(id);

            if (firebaseEnabled) {
              const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}&updateMask.fieldPaths=status`;
              const payload = {
                fields: {
                  status: { stringValue: 'approved' }
                }
              };
              const fRes = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              if (!fRes.ok) {
                const rawErr = await fRes.text();
                throw new Error(`Firebase 审批失败 (${fRes.status}): ${rawErr}`);
              }
              res.end(JSON.stringify({ success: true, message: 'Approved' }));
              return;
            }

            // Local fallback
            const pendingPath = path.join(PENDING_DIR, `${fileId}.json`);
            const approvedPath = path.join(APPROVED_DIR, `${fileId}.json`);

            if (!fs.existsSync(pendingPath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Pending submission not found' }));
              return;
            }

            const data = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
            data.status = 'approved';

            fs.writeFileSync(approvedPath, JSON.stringify(data, null, 2), 'utf-8');
            fs.unlinkSync(pendingPath);

            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/admin/reject' && method === 'POST') {
            const body = await parseBody();
            const { id } = body;
            if (!id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing Id' }));
              return;
            }

            const fileId = sanitizeId(id);

            if (firebaseEnabled) {
              const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
              const fRes = await fetch(url, {
                method: 'DELETE'
              });
              if (!fRes.ok) {
                const rawErr = await fRes.text();
                throw new Error(`Firebase 驳回失败 (${fRes.status}): ${rawErr}`);
              }
              res.end(JSON.stringify({ success: true }));
              return;
            }

            // Local fallback
            const pendingPath = path.join(PENDING_DIR, `${fileId}.json`);
            if (!fs.existsSync(pendingPath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Pending submission not found' }));
              return;
            }

            fs.unlinkSync(pendingPath);
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/admin/edit-approved' && method === 'POST') {
            const body = await parseBody();
            const { id, name } = body;
            if (!id || !name) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing parameters' }));
              return;
            }

            const fileId = sanitizeId(id);

            if (firebaseEnabled) {
              const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}&updateMask.fieldPaths=name`;
              const payload = {
                fields: {
                  name: { stringValue: name }
                }
              };
              const fRes = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              if (!fRes.ok) {
                const rawErr = await fRes.text();
                throw new Error(`Firebase 修改失败 (${fRes.status}): ${rawErr}`);
              }
              res.end(JSON.stringify({ success: true }));
              return;
            }

            // Local fallback
            const approvedPath = path.join(APPROVED_DIR, `${fileId}.json`);
            if (!fs.existsSync(approvedPath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Approved submission not found' }));
              return;
            }

            const data = JSON.parse(fs.readFileSync(approvedPath, 'utf-8'));
            data.name = name;
            fs.writeFileSync(approvedPath, JSON.stringify(data, null, 2), 'utf-8');
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/admin/delete-approved' && method === 'POST') {
            const body = await parseBody();
            const { id } = body;
            if (!id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing Id' }));
              return;
            }

            const fileId = sanitizeId(id);

            if (firebaseEnabled) {
              const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
              const fRes = await fetch(url, {
                method: 'DELETE'
              });
              if (!fRes.ok) {
                const rawErr = await fRes.text();
                throw new Error(`Firebase 删除失败 (${fRes.status}): ${rawErr}`);
              }
              res.end(JSON.stringify({ success: true }));
              return;
            }

            // Local fallback
            const approvedPath = path.join(APPROVED_DIR, `${fileId}.json`);
            if (!fs.existsSync(approvedPath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Approved submission not found' }));
              return;
            }

            fs.unlinkSync(approvedPath);
            res.end(JSON.stringify({ success: true }));
            return;
          }

          // Unhandled route under /api/
          return next();
        } catch (e: any) {
          console.error('[Vite Proxy Plugin Error]:', e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message || 'Internal Server Error' }));
        }
      });
    }
  };
}
