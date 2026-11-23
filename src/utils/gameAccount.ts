export type GameLeaderboardKey = { game: 'line' | 'station' | 'city' | 'county'; difficulty: 'easy' | 'hell' | 'hard' };
export type GameAccount = { id: string; email?: string; displayName: string };
export type GameRun = { id: string; game: GameLeaderboardKey['game']; difficulty: GameLeaderboardKey['difficulty']; startedAt: string };
export type LeaderboardEntry = { rank: number; displayName: string; score: number; achievedAt: string; isCurrentUser?: boolean };

const configuredUrl = (import.meta.env.VITE_GAME_GATEWAY_URL || import.meta.env.VITE_CITY_UPDATE_GATEWAY_URL || '').replace(/\/$/, '');
export const gameAccountEnabled = Boolean(configuredUrl);
const endpoint = (path: string) => `${configuredUrl}${path}`;

async function request<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  if (!configuredUrl) throw Error('排行榜服务尚未配置。');
  const response = await fetch(endpoint(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || '排行榜服务暂时不可用。');
  return body as T;
}

export async function signUpGameAccount(email: string, password: string, displayName: string) {
  return request<{ account?: GameAccount; accessToken?: string; confirmationRequired?: boolean }>('/game-auth/sign-up', { method: 'POST', body: JSON.stringify({ email, password, displayName }) });
}
export async function signInGameAccount(email: string, password: string) {
  return request<{ account: GameAccount; accessToken: string }>('/game-auth/sign-in', { method: 'POST', body: JSON.stringify({ email, password }) });
}
export async function getGameAccount(accessToken: string) { return request<{ account: GameAccount }>('/game-auth/me', {}, accessToken); }
export async function startGameRun(key: GameLeaderboardKey, accessToken: string) {
  return request<{ run: GameRun }>('/game-runs', { method: 'POST', body: JSON.stringify(key) }, accessToken);
}
export async function finishGameRun(id: string, score: number, accessToken: string) {
  return request<{ accepted: boolean; bestScore: number; rank?: number }>('/game-runs/' + encodeURIComponent(id) + '/finish', { method: 'POST', body: JSON.stringify({ score }) }, accessToken);
}
export async function getGameLeaderboard(key: GameLeaderboardKey, accessToken?: string) {
  const query = new URLSearchParams(key).toString();
  return request<{ entries: LeaderboardEntry[] }>(`/leaderboards?${query}`, {}, accessToken);
}
