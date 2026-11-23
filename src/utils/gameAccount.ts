export type GameLeaderboardKey = { game: 'line' | 'station' | 'city' | 'county'; difficulty: 'easy' | 'hell' | 'hard' };
export type GameAccount = { id: string; phone?: string; displayName: string; avatarUrl?: string };
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

export async function requestPhoneOtp(phone: string) {
  return request<{ sent: boolean }>('/game-auth/otp', { method: 'POST', body: JSON.stringify({ phone }) });
}
export async function verifyPhoneOtp(phone: string, token: string, displayName?: string) {
  return request<{ account: GameAccount; accessToken: string }>('/game-auth/verify', { method: 'POST', body: JSON.stringify({ phone, token, displayName }) });
}
export async function completeWechatLink(token: string, accessToken: string) {
  return request<{ bound: true }>('/wechat/complete', { method: 'POST', body: JSON.stringify({ token }) }, accessToken);
}
export async function getGameAccount(accessToken: string) { return request<{ account: GameAccount }>('/game-auth/me', {}, accessToken); }
export async function updateGameProfile(displayName: string, avatar?: File, accessToken?: string) {
  let avatarData: string | undefined;
  if (avatar) avatarData = await compressAvatar(avatar);
  return request<{ account: GameAccount }>('/game-profile', { method: 'POST', body: JSON.stringify({ displayName, avatarData }) }, accessToken);
}
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

async function compressAvatar(file: File): Promise<string> {
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
