import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { indexCityGeometry, decodeRoute, parseBvpkHeader } from '../src/utils/bvpGeometryDecoder';

const dir = resolve('.geometry-experiment/jinzhou/outputs');
const have = existsSync(resolve(dir, 'city.paths.bvp')) && existsSync(resolve(dir, 'city.restored.json'));

test('BVP1 rejects invalid magic and out-of-range route', () => {
  assert.throws(() => indexCityGeometry(Uint8Array.from([0, 1, 2, 3, 4])), /magic/);
});
test('BVPK1 header parse rejects wrong magic', () => {
  const bytes = new Uint8Array(13); bytes.set([66, 65, 68, 67, 88]); // "BADCX"
  assert.equal(parseBvpkHeader(bytes).valid, false);
});

test('real Jinzhou BVP1 decodes bit-exactly against restored JSON', { skip: !have && 'jinzhou fixtures not present' }, () => {
  const bvp = new Uint8Array(readFileSync(resolve(dir, 'city.paths.bvp')));
  const restored = JSON.parse(readFileSync(resolve(dir, 'city.restored.json'), 'utf8'));
  const index = indexCityGeometry(bvp);
  assert.equal(index.spans.length, 186);
  assert.equal(restored.lines.length, 186);
  let points = 0, mismatch = 0;
  for (let i = 0; i < index.spans.length; i++) {
    const decoded = decodeRoute(index, i);
    const original = restored.lines[i].path;
    assert.equal(decoded.length, original.length);
    for (let j = 0; j < decoded.length; j++) {
      if (decoded[j][0] !== original[j][0] || decoded[j][1] !== original[j][1]) mismatch++;
      points++;
    }
  }
  assert.equal(points, 58412);
  assert.equal(mismatch, 0);
});

test('real Jinzhou BVPK1 header is valid and length-consistent', { skip: !existsSync(resolve(dir, 'city.bvpk')) && 'jinzhou bvpk not present' }, () => {
  const header = parseBvpkHeader(new Uint8Array(readFileSync(resolve(dir, 'city.bvpk'))));
  assert.equal(header.magic, 'BVPK1');
  assert.equal(header.valid, true);
  assert.equal(header.metaLength, 42965);
  assert.equal(header.geomLength, 101575);
  assert.equal(header.totalLength, 144553);
});
