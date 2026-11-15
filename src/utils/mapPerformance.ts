export type MapPoint = [number, number];
/** Same greedy joining order/tolerance as the old scanner, using endpoint buckets. */
export function joinLineSegments(paths: MapPoint[][], epsilon = 1e-7): MapPoint[][] {
  const remaining = new Set(paths.map((_, index) => index));
  const cells = new Map<string, Set<number>>();
  const bucket = (point: MapPoint) => [Math.floor(point[0] / epsilon), Math.floor(point[1] / epsilon)];
  const near = (a: MapPoint, b: MapPoint) => Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon;
  paths.forEach((path, index) => {
    if (!path.length) return;
    for (const point of [path[0], path[path.length - 1]]) {
      const [x, y] = bucket(point), key = `${x},${y}`;
      if (!cells.has(key)) cells.set(key, new Set());
      cells.get(key)!.add(index);
    }
  });
  const remove = (index: number) => {
    remaining.delete(index);
    const path = paths[index];
    if (!path.length) return;
    for (const point of [path[0], path[path.length - 1]]) {
      const [x, y] = bucket(point);
      cells.get(`${x},${y}`)?.delete(index);
    }
  };
  const output: MapPoint[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!;
    remove(first);
    if (!paths[first].length) { output.push([]); continue; }
    let start = paths[first][0], end = paths[first].at(-1)!;
    const prepend: MapPoint[][] = [], append: MapPoint[][] = [];
    for (;;) {
      let best = Infinity, action = 0;
      for (const endpoint of [start, end]) {
        const [x, y] = bucket(endpoint);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const candidates = cells.get(`${x + dx},${y + dy}`);
          if (!candidates) continue;
          for (const index of candidates) {
            if (index >= best) continue;
            const path = paths[index], a = path[0], b = path.at(-1)!;
            const match = near(b, start) ? 1 : near(a, end) ? 2 : near(a, start) ? 3 : near(b, end) ? 4 : 0;
            if (match) { best = index; action = match; }
          }
        }
      }
      if (!action) break;
      const path = paths[best]; remove(best);
      if (action === 1) { const part = path.slice(0, -1); if (part.length) { prepend.push(part); start = part[0]; } }
      else if (action === 2) { const part = path.slice(1); if (part.length) { append.push(part); end = part.at(-1)!; } }
      else if (action === 3) { const part = path.slice(1).reverse(); if (part.length) { prepend.push(part); start = part[0]; } }
      else { const part = path.slice(0, -1).reverse(); if (part.length) { append.push(part); end = part.at(-1)!; } }
    }
    output.push([...prepend.reverse().flat(), ...paths[first], ...append.flat()]);
  }
  return output;
}
