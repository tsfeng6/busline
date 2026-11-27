import type { GameMode } from './offlineGame';

export const contestSeason = 'S1';

export const contests = [
  { id: 'line-beijing', game: 'line', scope: '北京市', title: '看图猜线路·北京' },
  { id: 'line-shanghai', game: 'line', scope: '上海市', title: '看图猜线路·上海' },
  { id: 'station-beijing', game: 'station', scope: '北京市', title: '看通达度猜站名·北京' },
  { id: 'station-shanghai', game: 'station', scope: '上海市', title: '看通达度猜站名·上海' },
  { id: 'city', game: 'city', scope: '全国', title: '看线网猜城市' },
  { id: 'county', game: 'county', scope: '河北省', title: '看线网猜县城' },
] as const;

export const contestRegions = [
  { id: 'beijing', title: '北京', cityScope: '北京市', contests: ['line-beijing', 'station-beijing'] },
  { id: 'shanghai', title: '上海', cityScope: '上海市', contests: ['line-shanghai', 'station-shanghai'] },
  { id: 'nationwide', title: '全国', contests: ['city'] },
  { id: 'hebei', title: '河北', provinceScope: '河北省', contests: ['county'] },
] as const;

export const contestPrompts = {
  line: '请根据公交线网猜线路。', station: '请根据公交线网猜目标站。',
  city: '请根据公交线网猜城市。', county: '请根据周边公交线网猜县城。',
};

type Tag = { id: string; label: string; factor: number };
export function contestTagGroups(mode: GameMode): { label: string; tags: Tag[] }[] {
  if (mode === 'city' || mode === 'county') {
    return [{ label: '答题方式', tags: [{ id: 'fill', label: '填空题', factor: 5 }] }];
  }
  return [
    { label: '考题范围', tags: [
      ...(mode === 'line' ? [{ id: 'special', label: '扩大至市区非常规线路', factor: 2 }] : []),
      { id: 'all-city', label: mode === 'line' ? '扩大至郊区线路' : '扩大至全市', factor: 3 },
      ...(mode === 'line' ? [
        { id: 'niche', label: '扩大至小众线路', factor: 4 },
        { id: 'unusual', label: '扩大至古怪线路', factor: 5 },
      ] : []),
    ] },
    { label: '底图', tags: [
      { id: 'network-only', label: '仅线路图', factor: 3 },
      { id: 'no-base', label: '无底图', factor: 5 },
    ] },
    { label: '站点', tags: [{ id: 'no-stops', label: '无站点', factor: 2 }] },
    { label: '提示次数', tags: [
      { id: 'hints-5', label: '5 个提示', factor: 1.5 },
      { id: 'hints-3', label: '3 个提示', factor: 2 },
      { id: 'hints-0', label: '无提示', factor: 3 },
    ] },
    { label: '每题限时', tags: [
      { id: 'time-60', label: '1 分钟', factor: 1.5 },
      { id: 'time-30', label: '30 秒', factor: 3 },
      { id: 'time-10', label: '10 秒', factor: 5 },
      { id: 'time-5', label: '5 秒', factor: 6 },
    ] },
    { label: '答题方式', tags: [
      { id: 'nearby', label: '混淆选项', factor: 3 },
      { id: 'fill', label: '填空题', factor: 5 },
    ] },
    ...(mode === 'station' ? [{ label: '线网显示', tags: [{ id: 'cycle', label: '每秒轮流显示线路', factor: 10 }] }] : []),
  ];
}

export function contestRules(mode: GameMode, input: unknown) {
  if (!Array.isArray(input) || input.some(tag => typeof tag !== 'string') || new Set(input).size !== input.length) throw Error('竞赛标签无效。');
  const groups = contestTagGroups(mode);
  const tags = groups.flatMap(group => {
    const selected = group.tags.filter(tag => input.includes(tag.id));
    if (selected.length > 1) throw Error('每组只能选择一个标签。');
    return selected;
  });
  if (tags.length !== input.length) throw Error('竞赛标签无效。');
  const has = (tag: string) => input.includes(tag);
  const local = mode === 'line' || mode === 'station';
  const timed = tags.find(tag => tag.id.startsWith('time-'));
  const hints = tags.find(tag => tag.id.startsWith('hints-'));
  return {
    tags: tags.map(tag => tag.id),
    multiplier: tags.reduce((product, tag) => product * tag.factor, local ? 0.5 : 1),
    perQuestion: local,
    timeLimit: timed ? Number(timed.id.slice(5)) : local ? 120 : 180,
    hintLimit: hints ? Number(hints.id.slice(6)) : 7,
    showBasemap: local && !has('network-only') && !has('no-base'),
    showNetworkContext: local && !has('no-base'),
    showStops: local && !has('no-stops'),
    fill: has('fill'), nearby: has('nearby'), cycle: has('cycle'),
    range: has('unusual') ? 'unusual' : has('niche') ? 'niche' : has('all-city') ? 'all-city' : has('special') ? 'special' : 'urban',
  };
}

export type ContestRules = ReturnType<typeof contestRules>;

export function isCitywideContest(range: ContestRules['range']) {
  return range === 'all-city' || range === 'niche' || range === 'unusual';
}
