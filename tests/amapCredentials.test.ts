import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAmapCredentials } from '../src/utils/amapCredentials';
import { readCocomapKey } from '../src/utils/cocomap';

const key = 'a'.repeat(32);
const securityCode = 'b'.repeat(32);
const storage = (values: Record<string, string> = {}) => ({
  getItem: (name: string) => values[name] ?? null,
});

test('uses valid enabled custom credentials for the map and search', () => {
  assert.deepEqual(resolveAmapCredentials(storage({
    app_use_custom_api_key: 'true',
    app_custom_api_key: ` ${key} `,
    app_custom_api_security_code: ` ${securityCode} `,
  }), 'public', 'public-code'), { key, securityCode, isCustom: true });
});

test('falls back to the public credentials when custom values are incomplete', () => {
  assert.deepEqual(resolveAmapCredentials(storage({
    app_use_custom_api_key: 'true',
    app_custom_api_key: key,
  }), 'public', 'public-code'), { key: 'public', securityCode: 'public-code', isCustom: false });
  assert.deepEqual(resolveAmapCredentials(storage({
    app_use_custom_api_key: 'true',
    app_custom_api_key: 'not-a-key',
    app_custom_api_security_code: securityCode,
  }), 'public', 'public-code'), { key: 'public', securityCode: 'public-code', isCustom: false });
});

test('ignores stored credentials while the custom switch is off', () => {
  assert.deepEqual(resolveAmapCredentials(storage({
    app_use_custom_api_key: 'false',
    app_custom_api_key: key,
    app_custom_api_security_code: securityCode,
  }), 'public', 'public-code'), { key: 'public', securityCode: 'public-code', isCustom: false });
});

test('keeps the public credentials when storage is unavailable', () => {
  assert.deepEqual(resolveAmapCredentials(undefined, 'public', 'public-code'),
    { key: 'public', securityCode: 'public-code', isCustom: false });
});

test('selecting Cocomap reads its own key and leaves the JS SDK on public credentials', () => {
  const config = storage({
    app_use_custom_api_key: 'true',
    app_amap_api_provider: 'cocomap',
    app_cocomap_api_key: ' sk_coco_example ',
    app_custom_api_key: key,
    app_custom_api_security_code: securityCode,
  });
  assert.equal(readCocomapKey(config), 'sk_coco_example');
  assert.deepEqual(resolveAmapCredentials(config, 'public', 'public-code'),
    { key: 'public', securityCode: 'public-code', isCustom: false });
});
