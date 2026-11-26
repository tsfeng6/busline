import type { RankedPuzzle, RankedResult } from './rankedGame';
export type GameLeaderboardKey = { game: 'line' | 'station' | 'city' | 'county'; difficulty: 'easy' | 'hell' | 'hard'; scope?: string };
export type GameAccount = { id: string; phone?: string; displayName: string; avatarUrl?: string };
export type GameRun = { id: string; game: GameLeaderboardKey['game']; difficulty: GameLeaderboardKey['difficulty']; scope?: string; startedAt: string; browserQuestions?: boolean };
export type LeaderboardEntry = { rank: number; displayName: string; avatarUrl?: string; score: number; achievedAt: string; isCurrentUser?: boolean };

const configuredUrl = (import.meta.env.VITE_GAME_GATEWAY_URL || import.meta.env.VITE_CITY_UPDATE_GATEWAY_URL || '').replace(/\/$/, '');
export const gameAccountEnabled = Boolean(configuredUrl);
const endpoint = (path: string) => `${configuredUrl}${path}`;

async function request<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  if (!configuredUrl) throw Error('排行榜服务尚未配置。');
  const response = await fetch(endpoint(path), {
    ...init,
    credentials: 'include',
    signal: init.signal ?? AbortSignal.timeout(20000),
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken && accessToken !== 'cookie' ? { Authorization: `Bearer ${accessToken}` } : {}), ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(body.error || '排行榜服务暂时不可用。'), { status: response.status });
  return body as T;
}

export async function requestPhoneOtp(phone: string) {
  return request<{ sent: boolean }>('/game-auth/otp', { method: 'POST', body: JSON.stringify({ phone }) });
}
export async function verifyPhoneOtp(phone: string, token: string, displayName?: string) {
  return request<{ account: GameAccount; accessToken: string }>('/game-auth/verify', { method: 'POST', body: JSON.stringify({ phone, token, displayName }) });
}
export async function completeWechatLink(token: string, accessToken: string) {
  return request<{ bound: true }>('/wechat/complete', { method: 'POST', body: JSON.stringify({ token }) }, accessToken);
}
export async function establishGameSession(accessToken: string) {
  return sessionProfile(await request<SignInResponse>('/game-auth/session', { method: 'POST' }, accessToken));
}
export async function endGameSession() {
  const result = await request<{ signedOut: true }>('/game-auth/logout', { method: 'POST' });
  if (result?.signedOut !== true) throw Error('退出登录未获确认，请重试。');
}
export async function deleteGameAccount(accessToken?: string) {
  return request<{ deleted: true }>('/game-auth/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) }, accessToken);
}
export async function passwordLogin(accountName: string, password: string) {
  return sessionProfile(await request<SignInResponse>('/game-auth/password-login', {
    method: 'POST', body: JSON.stringify({ accountName, password }),
  }));
}
type SignInResponse = { signedIn: true; account?: GameAccount };

function requireAccount(account?: GameAccount) {
  if (typeof account?.id !== 'string' || !account.id.trim()) {
    throw Object.assign(Error('没有有效的登录资料。'), { status: 401 });
  }
  return { account };
}

function sessionProfile(result: SignInResponse) {
  if (result?.signedIn !== true) throw Error('登录未获确认，请重试。');
  // During rollout an older gateway may still return only signedIn.
  return result.account === undefined ? getGameAccount() : requireAccount(result.account);
}

export async function getGameAccount() {
  const result = await request<{ account: GameAccount }>('/game-auth/me');
  return requireAccount(result?.account);
}
export async function updateGameProfile(displayName: string, avatar?: File, accessToken?: string) {
  let avatarData: string | undefined;
  if (avatar) avatarData = await compressAvatar(avatar);
  return request<{ account: GameAccount }>('/game-profile', { method: 'POST', body: JSON.stringify({ displayName, avatarData }) }, accessToken);
}
export async function startGameRun(key: Pick<GameLeaderboardKey, 'game' | 'scope'>, accessToken: string, tags: string[]) {
  return request<{ run: GameRun }>('/ranked-game-runs', { method: 'POST', body: JSON.stringify({ ...key, tags, browserQuestions: true }) }, accessToken);
}
export function getRankedPack(run: string, number: number, accessToken: string, signal?: AbortSignal) {
  return request<{ number: number; ticket: string }>(`/ranked-game-runs/${encodeURIComponent(run)}/pack`, {
    method: 'POST', body: JSON.stringify({ number }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
  }, accessToken);
}
export function getRankedPuzzle(run: string, number: number, accessToken: string, ticket?: string, sourceRevision?: string) {
  return request<RankedPuzzle>(`/ranked-game-runs/${encodeURIComponent(run)}/question`, {
    method: 'POST', body: JSON.stringify({ number, ticket, sourceRevision }), signal: AbortSignal.timeout(45000),
  }, accessToken);
}
export function answerRankedPuzzle(run: string, id: string, answer: string, timeout: boolean, accessToken: string) {
  return request<RankedResult | { pendingMs: number }>(`/ranked-game-runs/${encodeURIComponent(run)}/answer`, {
    method: 'POST', body: JSON.stringify({ id, answer, timeout }),
  }, accessToken);
}
export function hintRankedPuzzle(run: string, id: string, step: number, accessToken: string) {
  return request<{ text: string; remaining: number; used: number; complete: boolean }>(`/ranked-game-runs/${encodeURIComponent(run)}/hint`, {
    method: 'POST', body: JSON.stringify({ id, step }),
  }, accessToken);
}
export function getContestLeaderboard(game: GameLeaderboardKey['game'], scope: string, accessToken?: string) {
  const query = new URLSearchParams({ game, scope });
  return request<{ entries: LeaderboardEntry[] }>(`/contest-leaderboards?${query}`, {}, accessToken);
}

export async function compressAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw Error('请选择图片文件。');
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.78));
  if (!blob || blob.size > 180 * 1024) throw Error('头像压缩后仍过大，请换一张图片。');
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(Error('头像读取失败。')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob);
  });
}
