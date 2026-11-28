import { createHmac, randomBytes } from 'node:crypto';
import {
  isBeijingPilotRoute, isFreshVehicle, VEHICLE_POLL_MS,
  type BeijingPilotRoute, type BeijingPilotResponse, type LiveVehicle,
} from '../../src/utils/beijingRealtime';

type Snapshot = { source: string; routes: Map<BeijingPilotRoute, Map<string, LiveVehicle>> };
const markerSecret = randomBytes(32);
let cached: { url: string; token: string; until: number; pending: Promise<Snapshot | null> } | undefined;

async function readFeed(url: URL, token: string, transport: typeof fetch): Promise<Snapshot> {
  const response = await transport(url, {
    signal: AbortSignal.timeout(6000), redirect: 'error',
    headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  if (!response.ok || !response.body) throw Error('Vehicle feed unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, json = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256 * 1024) {
        await reader.cancel();
        throw Error('Vehicle feed too large');
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const feed = JSON.parse(json);
  if (typeof feed?.source !== 'string' || !feed.source.trim() || !Array.isArray(feed.positions)) {
    throw Error('Vehicle feed format invalid');
  }
  const now = Date.now();
  const routes: Snapshot['routes'] = new Map();
  for (const entry of feed.positions) {
    const { routeId, id, lng, lat, observedAt } = entry ?? {};
    if (typeof routeId !== 'string' || !isBeijingPilotRoute(routeId)
      || typeof id !== 'string' || !id || typeof lng !== 'number' || typeof lat !== 'number'
      || !(lng >= 115 && lng <= 118 && lat >= 38.5 && lat <= 41.5) || !isFreshVehicle(observedAt, now)) continue;
    const vehicles = routes.get(routeId) ?? new Map<string, LiveVehicle>();
    // Derive a stable ID for marker updates without returning an operator's raw identifier.
    const markerId = createHmac('sha256', markerSecret).update(JSON.stringify([routeId, id])).digest('hex').slice(0, 20);
    const latest = vehicles.get(markerId);
    if (!latest || observedAt > latest.observedAt) vehicles.set(markerId, { id: markerId, lng, lat, observedAt });
    routes.set(routeId, vehicles);
  }
  return { source: feed.source.trim().slice(0, 100), routes };
}

export async function readBeijingPilot(
  route: BeijingPilotRoute, feedUrl: string | undefined, token: string, transport: typeof fetch,
): Promise<BeijingPilotResponse> {
  if (!feedUrl) return { state: 'unconfigured' };
  let url: URL;
  try { url = new URL(feedUrl); }
  catch { return { state: 'unavailable' }; }
  if (url.protocol !== 'https:' || url.username || url.password) return { state: 'unavailable' };
  const now = Date.now();
  if (!cached || cached.url !== url.href || cached.token !== token || cached.until <= now) {
    cached = { url: url.href, token, until: now + VEHICLE_POLL_MS,
      pending: readFeed(url, token, transport).catch(() => null) };
  }
  const snapshot = await cached.pending;
  if (!snapshot) return { state: 'unavailable' };
  const vehicles = [...(snapshot.routes.get(route)?.values() ?? [])].filter(vehicle => isFreshVehicle(vehicle.observedAt));
  return { state: 'ready', source: snapshot.source, vehicles };
}
