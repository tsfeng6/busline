import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brotliDecompressSync } from 'node:zlib';
import { collectCityDataset } from '../scripts/collect-city-data';
import { cityStorageFiles } from '../scripts/city-storage-files';
import { packCitySnapshot } from '../scripts/city-bvpk-files';
import { cityBvpkPartPath } from '../src/utils/cityBvpk';
import { normalizeCityDataset } from '../src/utils/cityDataset';
import { discoverCityStops, searchCityLine } from '../src/utils/citySearch';
import { isSearchScopeCached } from '../src/utils/lineCache';
import { lineBaseIdentity } from '../src/utils/lineIdentity';
import { nearbyLines, type Point } from '../src/utils/localTransit';
import { getOperatingHours } from '../src/utils/operatingHours';
import { RouteRenderIndex } from '../src/utils/routeRenderIndex';
import { readCityJSON } from '../src/utils/sharedCityRead';
import { OperatingHours } from '../src/components/OperatingHours';

const cases = [
  { city: '北京市', district: '110108', code: '110000', route: '449路', stop: '马连洼北路东口', point: [116.289, 40.033] as Point },
  { city: '上海市', district: '310115', code: '310000', route: '611路', stop: '航津路地铁站', point: [121.594, 31.336] as Point },
  { city: '沧州市', district: '130930', code: '130900', route: '孟村662路', stop: '开发区管委会', point: [117.109602, 38.103545] as Point },
];

for (const example of cases) {
  test(`${example.city} ${example.route} survives county discovery, storage, viewport and nearby lookup`, async () => {
    const { city, district, code, route, stop, point: [lng, lat] } = example;
    const path: Point[] = [[lng - 0.004, lat], [lng + 0.004, lat]];
    const options = { wait: async () => {}, fetcher: (async input => {
      const url = new URL(String(input)), scope = url.searchParams.get('city');
      if (url.pathname.endsWith('/district')) return Response.json({
        status: '1', districts: [{ name: city, level: 'city', adcode: code,
          districts: [{ name: stop, level: 'district', adcode: district }] }],
      });
      if (url.pathname.endsWith('/text')) return Response.json({
        status: '1', count: scope === district ? '1' : '0', pois: scope === district
          ? [{ id: 's', name: stop, location: `${lng},${lat}`, adcode: district, address: route }]
          : [],
      });
      assert.equal(url.searchParams.get('keywords'), route);
      return Response.json({ status: '1', count: scope === district ? '2' : '0', buslines: scope === district
        ? [path, [...path].reverse()].map((points, i) => ({
          id: `direction-${i}`, name: `${route}(${i ? '乙--甲' : '甲--乙'})`, polyline: points.map(p => p.join(',')).join(';'),
        })) : [] });
    }) as typeof fetch };
    const { dataset, report } = await collectCityDataset(city, 'fixture-key', options);
    assert.equal(dataset.retrievalComplete, true);
    assert.deepEqual(report.counts, { district: 1, poi: 2, line: 2 });
    assert.equal(dataset.lines.length, 2);
    assert.equal(dataset.stops[0].name, stop);
    assert.ok(dataset.lines.every(line => line.city === city));

    const prefix = 'city-data/v1/test', id = '2026-11-22T00-00-00-000Z-abcdef123456';
    const legacy = new Map([...cityStorageFiles(dataset, prefix, id, true, 450)].map(file => [file.path, file.content]));
    const binary = await packCitySnapshot(dataset, prefix, id, 450);
    const formats = [
      (file: string) => file === `${prefix}/latest.json` ? Response.json(dataset) : new Response(null, { status: 404 }),
      (file: string) => new Response(legacy.get(file)),
      (file: string) => file.endsWith('latest.json') ? Response.json(binary.manifest)
        : new Response(new Uint8Array(binary.files.find(part => part.path === file)!.content)),
    ];
    assert.ok(binary.manifest.parts.length > 1);
    assert.equal(JSON.parse(legacy.get(`${prefix}/latest.json`)!).storage, 'city-parts-v1');
    for (const format of formats) {
      const restored = normalizeCityDataset(await readCityJSON('/' + prefix + '/latest.json',
        async input => format(String(input).slice(1).split('?')[0]), {
          decompress: bytes => brotliDecompressSync(bytes),
        }));
      assert.deepEqual(restored.lines, dataset.lines);
      assert.deepEqual(nearbyLines(restored, [lng, lat]).map(hit => lineBaseIdentity(hit.line.name)), [lineBaseIdentity(route)]);
      const index = new RouteRenderIndex(restored.lines.map(line => ({ ...line, displayPath: line.path })));
      const visible = index.visiblePaths({ minLng: lng - 0.00001, maxLng: lng + 0.00001, minLat: lat - 0.00001, maxLat: lat + 0.00001 });
      assert.equal(visible.size, 2);
      assert.equal(index.query([lng, lat], 0.00002).length, 2);
    }
    assert.ok(cityBvpkPartPath(binary.manifest.parts[0]).endsWith('.bvpk'));
  });
}

test('large browser search processes more than 200 station records with bounded requests and loads all line pages', async t => {
  const calls: string[] = [];
  const targetScopes = new Set(cases.map(example => example.district));
  let districtQueries = 0, boundsQueries = 0, lineQueries = 0;
  const services = {
    DistrictSearch: class {
      constructor(private opts: { subdistrict: number }) {}
      search(scope: string, callback: Function) {
        districtQueries++;
        const district = this.opts.subdistrict ? { adcode: '110000', districtList: cases.map(c => ({ level: 'district', adcode: c.district })) }
          : { adcode: scope, boundaries: [[{ lng: 116, lat: 39 }, { lng: 116.4, lat: 39.4 }]] };
        callback('complete', { districtList: [district] });
      }
    },
    PlaceSearch: class {
      private page = 1;
      constructor(private opts: { city: string; citylimit: boolean }) {
        assert.ok(this.opts.citylimit);
        assert.ok(targetScopes.has(this.opts.city));
      }
      setPageIndex(page: number) { this.page = page; }
      search(_: string, callback: Function) {
        calls.push(this.opts.city);
        callback('complete', { poiList: { count: 200, pois: this.records(['root']) } });
      }
      searchInBounds(_: string, bounds: Point[], callback: Function) {
        boundsQueries++;
        callback('complete', { poiList: { count: 76, pois: this.records(bounds.flat()) } });
      }
      records(key: (string | number)[]) {
        const { route, stop, point: [lng, lat] } = cases.find(c => c.district === this.opts.city)!;
        const start = (this.page - 1) * 25;
        return Array.from({ length: start === 75 ? 1 : 25 }, (_, i) => ({
          id: [this.opts.city, ...key, start + i].join(':'), name: stop, location: { lng, lat },
          address: key[0] !== 'root' && start + i === 75 ? route : '',
        }));
      }
    },
    LineSearch: class {
      private page = 1;
      setPageIndex(page: number) { this.page = page; }
      search(_: string, callback: Function) {
        lineQueries++;
        const start = (this.page - 1) * 20;
        callback('complete', { count: 44, lineInfo: Array.from({ length: Math.min(20, 44 - start) }, (_, i) => ({
          id: String(start + i), name: start + i >= 42 ? `449路(方向${i})` : `449快速${i}`, path: [[116, 39], [116.1, 39.1]],
        })) });
      }
    },
  };
  const started = performance.now();
  const result = await discoverCityStops(services, '北京市', () => false, () => false);
  assert.equal(result.complete, true);
  assert.equal(result.pois.length, 987);
  assert.deepEqual(calls, cases.map(c => c.district));
  assert.equal(boundsQueries, 48);
  assert.deepEqual(new Set(result.pois.map(poi => poi.address).filter(Boolean)), new Set(cases.map(c => c.route)));
  const lineResult = await searchCityLine(services, '北京市', '449路', () => false, () => false);
  assert.equal(lineResult.complete, true);
  assert.equal(lineResult.lines.length, 44);
  assert.equal(lineResult.lines.filter(l => lineBaseIdentity(l.name) === '449').length, 2);
  assert.equal(lineQueries, 3);
  assert.equal(districtQueries + calls.length + boundsQueries + lineQueries, 58);
  t.diagnostic(`987 POIs, 44 directions, 58 mocked provider calls in ${(performance.now() - started).toFixed(1)} ms`);
});

test('citywide results from before partitioned discovery cannot suppress a new scan', () => {
  const bounds = { minLng: 116, minLat: 39, maxLng: 117, maxLat: 40 };
  const region = { id: 'b', city: '北京市', isCityWide: true, isComplete: true, searchBounds: bounds, timestamp: Date.now() };
  assert.equal(isSearchScopeCached([{ ...region, discoveryVersion: 4 }], bounds, true), false);
  assert.equal(isSearchScopeCached([{ ...region, discoveryVersion: 5 }], bounds, true), true);
});

test('449 direction cards show different operating windows and do not infer a schedule from a remark', () => {
  const cards = [
    { times: [['0620', '1020'], ['1620', '2020'], ['0950', '1750']], expected: /工作日 06:20–10:20、16:20–20:20.*周末、节假日 09:50–17:50/ },
    { times: [['0530', '0930'], ['1530', '1930'], ['0900', '1700']], expected: /工作日 05:30–09:30、15:30–19:30.*周末、节假日 09:00–17:00/ },
  ];
  for (const { times, expected } of cards) {
    const time_group = times.map(([start_time, end_time]) => ({ start_time, end_time }));
    const schedule = getOperatingHours({ timedesc: { allRemark: '运营时间以现场公告为准', rule_group: [
      { date: { day_type: ['workday'] }, time_group: time_group.slice(0, 2) },
      { date: { day_type: ['weekend', 'holiday'] }, remark: '休息日', time_group: time_group.slice(2) },
    ] } });
    const markup = renderToStaticMarkup(React.createElement(OperatingHours, {
      first: schedule.stime, last: schedule.etime, description: schedule.scheduleDescription,
    }));
    assert.match(markup, expected);
    assert.doesNotMatch(markup, /分日期运营/);
  }
  assert.match(renderToStaticMarkup(React.createElement(OperatingHours, { description: '请提前候车' })), /请提前候车/);
  assert.match(renderToStaticMarkup(React.createElement(OperatingHours, { first: '0610', last: '2200' })), /06:10.*22:00/);
});

test('the encoded AMap response for 449 preserves weekday and weekend hours', () => {
  const upstream = {
    rule_group: [
      { date: { day_type: ['weekend'], day_week: ['6', '7'], month_type: ['all'] },
        time_group: [{ start_time: '09:50:00', end_time: '17:50:00' }] },
      { date: { day_type: ['weekday'], day_week: ['1', '2', '3', '4', '5'], month_type: ['all'] },
        time_group: [{ start_time: '06:20:00', end_time: '10:20:00' }, { start_time: '16:20:00', end_time: '20:20:00' }] },
    ],
    allRemark: '周末 09:50-17:50\r\n工作日 06:20-10:20 16:20-20:20',
  };
  const timedesc = encodeURIComponent(JSON.stringify(upstream)).replaceAll('%7B', '{').replaceAll('%7D', '}')
    .replaceAll('%3A', ':').replaceAll('%5B', '[').replaceAll('%5D', ']');
  const schedule = getOperatingHours({ timedesc, stime: [], etime: [] });
  const markup = renderToStaticMarkup(React.createElement(OperatingHours, {
    first: schedule.stime, last: schedule.etime, description: schedule.scheduleDescription,
  }));
  assert.match(markup, /周末 09:50-17:50.*工作日 06:20-10:20 16:20-20:20/);
  assert.doesNotMatch(markup, /分日期运营/);
});

test('large snapshots index and query the last direction without a result-count cutoff', t => {
  const query: Point = [116.289, 40.033];
  const started = performance.now();
  const data = normalizeCityDataset({
    schemaVersion: 1, city: '北京市', scope: 'city', coverage: 'observed', retrievalComplete: true, filtered: false,
    capturedAt: '2026-11-22T00:00:00.000Z', stops: [{ name: '马连洼北路东口', location: query }],
    lines: Array.from({ length: 4000 }, (_, index) => {
      const target = index === 3999, latitude = target ? query[1] : 39 + index / 100000;
      return { id: String(index), name: target ? '449路(地铁上地站--永丰公交场站)' : `测试${index}路`,
        path: Array.from({ length: 129 }, (_, point) => [116.28 + point / 6400, latitude]) };
    }),
  });
  const index = new RouteRenderIndex(data.lines.map(line => ({ ...line, displayPath: line.path })));
  assert.equal(index.blockCount, 4000);
  assert.equal(index.visiblePaths({ minLng: 116.288, minLat: 40.03, maxLng: 116.29, maxLat: 40.035 }).size, 1);
  assert.equal(index.query(query, 0.00002)[0].lines.values().next().value, data.lines.at(-1)?.name);
  assert.deepEqual(nearbyLines(data, query).map(result => result.line.id), ['3999']);
  t.diagnostic(`4,000 directions and 512,000 segments indexed and queried in ${(performance.now() - started).toFixed(1)} ms`);
});
