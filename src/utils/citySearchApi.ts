export const AMAP_API_PRIVACY_NOTICE = '填写的高德 API 配置仅保存在您浏览器的本地，不会上传至本站服务器；调用高德服务时会发送给高德。请妥善保护您的设备，并在高德开放平台设置域名白名单。';

/** A live city search must use the visitor's complete configuration already loaded by the SDK. */
export function citySearchApiStatus(enabled: boolean, key: string, securityCode: string,
  active: {isCustom: boolean; key: string; securityCode: string}): 'missing' | 'reload' | 'ready' {
  if (!enabled || !/^[a-f0-9]{32}$/i.test(key.trim()) || !/^[a-f0-9]{32}$/i.test(securityCode.trim())) return 'missing';
  return active.isCustom && active.key === key.trim() && active.securityCode === securityCode.trim() ? 'ready' : 'reload';
}
