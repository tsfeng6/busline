export type Point = [number, number];
export type RenderRoute = { name: string; path: Point[]; displayPath: Point[] };
type Block = { route: number; start: number; end: number; minX: number; minY: number; maxX: number; maxY: number };
/** Exact geometry, indexed in small contiguous blocks instead of a Set/object per edge. */
export class RouteRenderIndex {
  private blocks: Block[] = [];
  constructor(readonly routes: RenderRoute[]) {
    routes.forEach((route, id) => {
      for (let start = 0; start < route.displayPath.length - 1; start += 128) {
        const end = Math.min(start + 128, route.displayPath.length - 1);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = start; i <= end; i++) {
          const [x, y] = route.displayPath[i];
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        this.blocks.push({ route: id, start, end, minX, minY, maxX, maxY });
      }
    });
  }
  get blockCount() { return this.blocks.length; }
  visiblePaths(box: {minLng:number;maxLng:number;minLat:number;maxLat:number}) {
    const paths = new Map<string, Point[][]>();
    let routeId = -1, start = -1, end = -1;
    const flush = () => {
      if (start < 0) return;
      const route = this.routes[routeId];
      if (!paths.has(route.name)) paths.set(route.name, []);
      paths.get(route.name)!.push(route.displayPath.slice(start, end + 1));
    };
    for (const b of this.blocks) {
      if (b.maxX < box.minLng || b.minX > box.maxLng || b.maxY < box.minLat || b.minY > box.maxLat) continue;
      if (b.route === routeId && b.start === end) end = b.end;
      else { flush(); routeId = b.route; start = b.start; end = b.end; }
    }
    flush(); return paths;
  }
  query(point: Point, radius: number) {
    const hits: { dist: number; lines: Set<string>; data: { start: Point; end: Point; offsetStart: Point; offsetEnd: Point } }[] = [];
    for (const b of this.blocks) {
      if (point[0] + radius < b.minX || point[0] - radius > b.maxX || point[1] + radius < b.minY || point[1] - radius > b.maxY) continue;
      const route = this.routes[b.route];
      for (let i = b.start; i < b.end; i++) {
        const a = route.displayPath[i], z = route.displayPath[i + 1];
        const dx = z[0] - a[0], dy = z[1] - a[1], len = dx * dx + dy * dy;
        if (!len) continue;
        const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len));
        const dist = Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
        if (dist < radius) hits.push({ dist, lines: new Set([route.name]), data: {
          start: route.path[i], end: route.path[i + 1], offsetStart: a, offsetEnd: z,
        } });
      }
    }
    return hits;
  }
}
/** Same visual right-side offset as before; never rewrites or drops source points. */
export function offsetRoutePath(path: Point[], offset = 0.000035): Point[] {
  let lastNormal: Point = [0, 0];
  const normal = (i: number): Point => {
    const dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1], len = Math.hypot(dx, dy);
    if (len) lastNormal = [dy / len, -dx / len];
    return lastNormal;
  };
  // Only five neighboring normals are needed at any point.
  const normals = new Map<number, Point>();
  const at = (i: number) => { let n = normals.get(i); if (!n) { n = normal(i); normals.set(i, n); } return n; };
  return path.map((p, i) => {
    if (path.length < 2) return [p[0], p[1]];
    let nx = 0, ny = 0, count = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(path.length - 2, i + 2); j++) { const n = at(j); nx += n[0]; ny += n[1]; count++; }
    nx /= count; ny /= count;
    const length = Math.hypot(nx, ny), current = at(Math.min(i, path.length - 2));
    if (i >= 3) normals.delete(i - 3);
    if (length <= .0001) return [p[0] + current[0] * offset, p[1] + current[1] * offset];
    nx /= length; ny /= length;
    const dot = nx * current[0] + ny * current[1], factor = dot > .5 ? Math.min(1.3, 1 / dot) : 1.3;
    return [p[0] + nx * offset * factor, p[1] + ny * offset * factor];
  });
}
