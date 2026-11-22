import { citySearchApiStatus } from './citySearchApi';

export type AmapCredentials = { key: string; securityCode: string; isCustom: boolean };

export function resolveAmapCredentials(
  storage: Pick<Storage, 'getItem'> | undefined,
  defaultKey: string,
  defaultSecurityCode: string,
): AmapCredentials {
  try {
    if (storage?.getItem('app_use_custom_api_key') === 'true') {
      const key = (storage.getItem('app_custom_api_key') || '').trim();
      const securityCode = (storage.getItem('app_custom_api_security_code') || '').trim();
      if (citySearchApiStatus(true, key, securityCode) === 'ready') {
        return { key, securityCode, isCustom: true };
      }
    }
  } catch {
    // Private browsing can block storage; keep the public map available.
  }
  return { key: defaultKey, securityCode: defaultSecurityCode, isCustom: false };
}
