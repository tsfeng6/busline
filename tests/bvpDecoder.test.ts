import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { openNodeBvpk, packCitySnapshot, readNodeCityBvpkPart } from '../scripts/city-bvpk-files';
import { resolveCityStorage } from '../src/utils/cityBvpk';
import { indexCityGeometry, decodeRoute, parseBvpkHeader } from '../src/utils/bvpGeometryDecoder';

const fixtures = process.env.BUSLINE_GEOMETRY_FIXTURES || '.geometry-experiment';
const dir = resolve(fixtures, 'jinzhou/outputs');
const have = existsSync(resolve(dir, 'city.paths.bvp')) && existsSync(resolve(dir, 'city.restored.json'));

test('BVP1 rejects invalid magic and out-of-range route', () => {
  assert.throws(() => indexCityGeometry(Uint8Array.from([0, 1, 2, 3, 4])), /magic/);
});
test('BVPK1 header parse rejects wrong magic', () => {
  const bytes = new Uint8Array(13); bytes.set([66, 65, 68, 67, 88]); // "BADCX"
  assert.equal(parseBvpkHeader(bytes).valid, false);
});
test('BVPK1 parts can be read concurrently without changing their published order', async () => {
  const manifest: any = {
    storage: 'city-bvpk1', snapshotId: '2026-11-22T00-00-00-000Z-abcdef123456',
    header: { schemaVersion: 1, city: '北京市', scope: 'city', coverage: 'observed', capturedAt: '2026-11-22T00:00:00.000Z', retrievalComplete: true, filtered: false },
    parts: [0, 1, 2].map(index => ({ sha256: String(index + 1).repeat(64), bytes: 15, lineCount: 1, stopCount: 1 })),
  };
  let active = 0, peak = 0;
  const progress: number[] = [];
  const data = await resolveCityStorage(manifest, async () => { throw Error('Unexpected legacy read'); }, async (part: any) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    const id = part.sha256[0];
    return { lines: [{ id, name: `${id}路`, path: [[116, 39], [116.01, 39.01]] }], stops: [{ id, name: `${id}站`, address: '', location: { lng: 116, lat: 39 } }] };
  }, { partConcurrency: 2, onPart: completed => progress.push(completed) });
  assert.equal(peak, 2);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.deepEqual(data.lines.map(line => line.id), ['1', '2', '3']);
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

const bjDir = resolve(fixtures, 'beijing/package/outputs');
const haveBj = existsSync(resolve(bjDir, 'city.paths.bvp')) && existsSync(resolve(bjDir, 'city.restored.json'));
test('real Beijing BVP1 decodes bit-exactly (903 lines / 502,911 points)', { skip: !haveBj && 'beijing fixtures not present' }, () => {
  const bvp = new Uint8Array(readFileSync(resolve(bjDir, 'city.paths.bvp')));
  const restored = JSON.parse(readFileSync(resolve(bjDir, 'city.restored.json'), 'utf8'));
  const index = indexCityGeometry(bvp);
  assert.equal(index.spans.length, 903);
  assert.equal(restored.lines.length, 903);
  let points = 0, mismatch = 0;
  for (let i = 0; i < index.spans.length; i++) {
    const decoded = decodeRoute(index, i); const original = restored.lines[i].path;
    assert.equal(decoded.length, original.length);
    for (let j = 0; j < decoded.length; j++) { if (decoded[j][0] !== original[j][0] || decoded[j][1] !== original[j][1]) mismatch++; points++; }
  }
  assert.equal(points, 502911);
  assert.equal(mismatch, 0);
});
test('real Beijing BVPK1 header is valid', { skip: !existsSync(resolve(bjDir, 'city.bvpk')) && 'beijing bvpk not present' }, () => {
  const header = parseBvpkHeader(new Uint8Array(readFileSync(resolve(bjDir, 'city.bvpk'))));
  assert.equal(header.magic, 'BVPK1');
  assert.equal(header.valid, true);
  assert.equal(header.metaLength, 530758);
  assert.equal(header.geomLength, 761927);
  assert.equal(header.totalLength, 1292698);
});

for (const [name, folder, lines, points] of [
  ['Jinzhou', dir, 186, 58412],
  ['Beijing', bjDir, 903, 502911],
] as const) {
  const original = resolve(folder, 'baseline.original.json.br');
  const experiment = resolve(folder, 'city.bvpk');
  test(`real ${name} original JSON equals the experimental and published BVPK1 decodes`, {
    skip: !existsSync(original) || !existsSync(experiment),
  }, async () => {
    const source = brotliDecompressSync(readFileSync(original));
    const data = JSON.parse(source.toString('utf8'));
    assert.equal(data.lines.length, lines);
    assert.equal(data.lines.reduce((total: number, line: any) => total + line.path.length, 0), points);
    const pack = await openNodeBvpk(readFileSync(experiment));
    assert.deepEqual({ ...pack.metadata, lines: pack.metadata.lines.map((_, index) => pack.route(index)) }, data);
    const snapshotId = data.capturedAt.replace(/[:.]/g, '-') + '-000000000000';
    const { manifest, files } = await packCitySnapshot(data, 'city', snapshotId);
    const assets = new Map(files.map(file => [file.path, file.content]));
    const decoded = await resolveCityStorage(manifest, async () => { throw Error('Unexpected legacy read'); }, descriptor =>
      readNodeCityBvpkPart(descriptor, async path => assets.get('city/' + path)!));
    assert.deepEqual(decoded, data);
    const bytes = Buffer.byteLength(JSON.stringify(manifest)) + files.reduce((total, file) => total + file.content.length, 0);
    console.log(`${name}: ${lines} routes / ${points} points, ${source.length} original bytes, ${bytes} published bytes in ${files.length} BVPK1 parts`);
  });
}
