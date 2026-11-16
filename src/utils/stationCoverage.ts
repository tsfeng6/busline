const stationCache = new Map<string, { time: number; lines: string[] }>();
const cleanName = (name: string) => name.replace(/\(.*?\)|（.*?）/g, '').replace(/公交站/g, '').trim();

/** Cross-check POI address labels against the transit station dataset. */
export async function discoverStationLines(AMap: any, city: string, stops: any[], cancelled: () => boolean): Promise<string[]> {
  const unique = new Map<string, any>();
  for (const stop of stops) {
    if (!stop.name || !stop.location) continue;
    const key = `${cleanName(stop.name)}:${Number(stop.location.lng).toFixed(3)},${Number(stop.location.lat).toFixed(3)}`;
    if (!unique.has(key)) unique.set(key, stop);
  }
  const lines = new Set<string>();
  const entries = Array.from(unique.entries());
  for (let i = 0; i < entries.length && !cancelled(); i += 3) {
    await Promise.all(entries.slice(i, i + 3).map(async ([key, stop]) => {
      const cacheKey = `${city}:${key}`;
      const cached = stationCache.get(cacheKey);
      if (cached && Date.now() - cached.time < 300000) {
        cached.lines.forEach(name => lines.add(name));
        return;
      }
      const found = await new Promise<string[]>(resolve => {
        let settled = false;
        const finish = (names: string[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(names);
        };
        const timer = setTimeout(() => finish([]), 6000);
        try {
          new AMap.StationSearch({ city, pageSize: 50, pageIndex: 1 }).search(cleanName(stop.name), (status: string, result: any) => {
            if (cancelled() || status !== 'complete') { finish([]); return; }
            const names = new Set<string>();
            for (const station of result?.stationInfo || []) {
              if (!station.location || cleanName(station.name || '') !== cleanName(stop.name)) continue;
              const dx = (station.location.lng - stop.location.lng) * Math.cos(stop.location.lat * Math.PI / 180);
              const dy = station.location.lat - stop.location.lat;
              if (dx * dx + dy * dy > 0.003 ** 2) continue;
              for (const line of station.buslines || []) if (line.name) names.add(line.name);
            }
            finish([...names]);
          });
        } catch { finish([]); }
      });
      if (!cancelled() && found.length) {
        stationCache.set(cacheKey, { time: Date.now(), lines: found });
        found.forEach(name => lines.add(name));
      }
    }));
  }
  return cancelled() ? [] : [...lines];
}

/** Index the entire segment, including its endpoints, rather than its midpoint. */
export function segmentGridKeys(a: [number, number], b: [number, number], scale = 1000): string[] {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * scale * 2));
  const keys = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    keys.add(`${Math.floor((a[0] + (b[0] - a[0]) * t) * scale)},${Math.floor((a[1] + (b[1] - a[1]) * t) * scale)}`);
  }
  return [...keys];
}
