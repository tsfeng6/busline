export const GAME_QUOTA_KEY = 'busline_public_game_daily_quota_v1';
export const PUBLIC_GAME_DAILY_LIMIT = 3;

export function getGameQuotaDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function readGameQuota(storage: Pick<Storage, 'getItem'>, date = new Date()): number {
  try {
    const record = JSON.parse(storage.getItem(GAME_QUOTA_KEY) || 'null');
    return record?.date === getGameQuotaDate(date) && Number.isInteger(record.count) && record.count >= 0
      ? Math.min(PUBLIC_GAME_DAILY_LIMIT, record.count) : 0;
  } catch { return 0; }
}
export function consumeGameQuota(storage: Pick<Storage, 'getItem' | 'setItem'>, date = new Date()): boolean {
  const count = readGameQuota(storage, date);
  if (count >= PUBLIC_GAME_DAILY_LIMIT) return false;
  // Persist before starting any API requests. Storage failures must not bypass the limit.
  storage.setItem(GAME_QUOTA_KEY, JSON.stringify({ date: getGameQuotaDate(date), count: count + 1 }));
  return true;
}
