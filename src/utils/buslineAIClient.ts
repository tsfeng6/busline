/** Build and validate the endpoint before fetch so browser-specific URL errors stay actionable. */
export function getBuslineAIEndpoint(base: string, pageUrl: string): string {
  const value = base.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\/+$/, '');
  if (value && !/^https?:\/\//i.test(value) && !value.startsWith('/')) throw new Error('Busline AI 后端地址格式不正确，请配置完整的 HTTPS 地址。');
  let url: URL;
  try {
    const path = !value ? '/api/ai/chat' : /\/api\/ai\/chat$/i.test(value) ? value : /\/api$/i.test(value) ? `${value}/ai/chat` : `${value}/api/ai/chat`;
    url = new URL(path, pageUrl);
  } catch { throw new Error('Busline AI 后端地址格式不正确，请检查配置。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Busline AI 后端地址配置不正确。');
  if (new URL(pageUrl).protocol === 'https:' && url.protocol !== 'https:') throw new Error('当前网站使用 HTTPS，Busline AI 后端也必须使用 HTTPS。');
  return url.href;
}

export async function readBuslineAIResponse(response: Response): Promise<any> {
  const text = await response.text();
  const html = /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(text) || /text\/html/i.test(response.headers.get('content-type') || '');
  if (html || response.status === 404 || response.status === 405) throw new Error('Busline AI 接口未部署或地址不正确。静态托管页面无法运行 AI 后端，请配置后端地址；本地开发请重启开发服务。');
  if (!text.trim()) throw new Error(`Busline AI 服务返回空响应（${response.status}），请检查后端或代理配置。`);
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Busline AI 服务未返回有效数据（${response.status}），请检查后端或代理配置。`); }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Busline AI 请求失败（${response.status}），请稍后重试。`);
  if (!data || typeof data.reply !== 'string' || (data.lines !== undefined && (!Array.isArray(data.lines) || data.lines.some((line: any) => typeof line !== 'string')))) throw new Error('Busline AI 返回的数据结构不正确，请检查后端版本。');
  return data;
}
export function describeBuslineAIError(error: any): string {
  const message = String(error?.message || '');
  if (error instanceof TypeError || /string did not match|expected pattern|load failed|failed to fetch|networkerror/i.test(message)) return '无法连接 Busline AI 后端，请检查后端地址、HTTPS 和跨域配置。本地开发请重启开发服务后再试。';
  return (message || 'Busline AI 连接失败，请稍后重试。').replace(/deep\s*seek|深度求索/gi, 'Busline AI');
}
