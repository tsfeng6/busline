import type { GameMode } from './offlineGame';

export const gameNames = {
  line: '猜线路', station: '猜公交站', accessibility: '看通达度猜公交站',
  city: '看线网猜城市', county: '看线网猜县城',
} satisfies Record<GameMode, string>;

export const contestSeason = 'S1';

export const contests = [
  { id: 'line-beijing', game: 'line', scope: '北京市', title: '猜线路·北京' },
  { id: 'line-shanghai', game: 'line', scope: '上海市', title: '猜线路·上海' },
  { id: 'station-beijing', game: 'station', scope: '北京市', title: '猜公交站·北京' },
  { id: 'station-shanghai', game: 'station', scope: '上海市', title: '猜公交站·上海' },
  { id: 'accessibility-beijing', game: 'accessibility', scope: '北京市', title: '看通达度猜公交站·北京' },
  { id: 'accessibility-shanghai', game: 'accessibility', scope: '上海市', title: '看通达度猜公交站·上海' },
  { id: 'city', game: 'city', scope: '全国', title: '看线网猜城市' },
  { id: 'county', game: 'county', scope: '河北省', title: '看线网猜县城' },
] as const;

export const contestRegions = [
  { id: 'beijing', title: '北京', cityScope: '北京市', contests: ['line-beijing', 'station-beijing', 'accessibility-beijing'] },
  { id: 'shanghai', title: '上海', cityScope: '上海市', contests: ['line-shanghai', 'station-shanghai', 'accessibility-shanghai'] },
  { id: 'nationwide', title: '全国', contests: ['city'] },
  { id: 'hebei', title: '河北', provinceScope: '河北省', contests: ['county'] },
] as const;

export const contestPrompts = {
  line: '请根据公交线网猜线路。', station: '请根据地图上标记的位置猜公交站。', accessibility: '请根据经过目标站的线路猜公交站。',
  city: '请根据公交线网猜城市。', county: '请根据周边公交线网猜县城。',
};

type Tag = { id: string; label: string; factor: number };
export function contestTagGroups(mode: GameMode): { label: string; tags: Tag[] }[] {
  if (mode === 'city' || mode === 'county') {
    return [{ label: '答题方式', tags: [{ id: 'fill', label: '填空题', factor: 5 }] }];
  }
  const suburbs = { id: 'all-city', label: '加入郊区', factor: 2 };
  return [
    { label: '考题范围', tags: mode === 'line' ? [
      { id: 'special', label: '扩大至微型线路', factor: 2 },
      { id: 'niche', label: '扩大至小众线路', factor: 3 },
      { id: 'unusual', label: '扩大至古怪线路', factor: 4 },
      { id: 'unlimited', label: '扩大至无限制', factor: 5 },
    ] : mode === 'accessibility' ? [
      { id: 'medium-stops', label: '扩大至中型站', factor: 2 },
      { id: 'all-stops', label: '扩大至小站', factor: 3 },
    ] : [suburbs] },
    ...(mode === 'station' ? [] : [{ label: '地区', tags: [suburbs] }]),
    ...(mode === 'accessibility' ? [] : [{ label: '底图', tags: [
      { id: 'network-only', label: '仅线路图', factor: 3 },
      ...(mode === 'line' ? [{ id: 'no-base', label: '无底图', factor: 5 }] : []),
    ] }]),
    ...(mode === 'station' ? [] : [{ label: '站点', tags: [{ id: 'no-stops', label: '无站点', factor: 2 }] }]),
    { label: '提示次数', tags: [
      { id: 'hints-5', label: '5 个提示', factor: 1.5 },
      { id: 'hints-3', label: '3 个提示', factor: 2 },
      { id: 'hints-0', label: '无提示', factor: 3 },
    ] },
    { label: '每题限时', tags: mode === 'accessibility' ? [
      { id: 'time-420', label: '7 分钟', factor: 1.5 },
      { id: 'time-300', label: '5 分钟', factor: 2 },
      { id: 'time-180', label: '3 分钟', factor: 3 },
      { id: 'time-60', label: '1 分钟', factor: 5 },
    ] : [
      { id: 'time-60', label: '1 分钟', factor: 1.5 },
      { id: 'time-30', label: '30 秒', factor: 3 },
      { id: 'time-10', label: '10 秒', factor: 5 },
      { id: 'time-5', label: '5 秒', factor: 6 },
    ] },
    { label: '答题方式', tags: [
      { id: 'nearby', label: '混淆选项', factor: 3 },
      { id: 'fill', label: '填空题', factor: 5 },
    ] },
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
  const local = mode === 'line' || mode === 'station' || mode === 'accessibility';
  const timed = tags.find(tag => tag.id.startsWith('time-'));
  const hints = tags.find(tag => tag.id.startsWith('hints-'));
  return {
    tags: tags.map(tag => tag.id),
    multiplier: tags.reduce((product, tag) => product * tag.factor, local ? 0.5 : 1),
    perQuestion: local,
    timeLimit: timed ? Number(timed.id.slice(5)) : mode === 'accessibility' ? 600 : local ? 120 : 180,
    hintLimit: hints ? Number(hints.id.slice(6)) : 7,
    showBasemap: local && mode !== 'accessibility' && !has('network-only') && !has('no-base'),
    showNetworkContext: local && mode !== 'accessibility' && !has('no-base'),
    showStops: local && mode !== 'station' && !has('no-stops'),
    fill: has('fill'), nearby: has('nearby'),
    includeSuburbs: has('all-city'),
    minStationRoutes: mode === 'accessibility' ? has('all-stops') ? 1 : has('medium-stops') ? 5 : 10 : 1,
    range: has('unlimited') ? 'unlimited' : has('unusual') ? 'unusual' : has('niche') ? 'niche' : has('special') ? 'special' : 'urban',
  };
}

export type ContestRules = ReturnType<typeof contestRules>;
