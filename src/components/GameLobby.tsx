import { ArrowLeft, ArrowUpRight, Gamepad2, History, Trophy } from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { contestRegions, contestRules, contestSeason, contestTagGroups, contests, isCitywideContest } from '../utils/contestRules';
import { getContestLeaderboard, type LeaderboardEntry } from '../utils/gameAccount';
import { hasContestDistricts } from '../utils/contestQuestions';
import type { PublishedCity } from '../utils/localTransit';
import type { GameMode } from '../utils/offlineGame';
import { ContestCardOutline } from './ContestCardOutline';
import { ContestNetworkMap } from './ContestNetworkMap';
import { GameLadderPanel } from './GameLadderPanel';
import { GameModeVisual } from './GameModeVisual';

type Contest = (typeof contests)[number];
export type ContestRegionId = (typeof contestRegions)[number]['id'];

type LobbyProps = {
  division: 'contest' | 'simulation';
  onDivision: (division: 'contest' | 'simulation') => void;
  contest: (typeof contests)[number];
  onContest: (contest: (typeof contests)[number]) => void;
  regionId: ContestRegionId | null;
  onRegion: (id: ContestRegionId | null) => void;
  tags: string[];
  onTags: (tags: string[]) => void;
  mode: GameMode;
  onMode: (mode: GameMode) => void;
  bestScore: number;
  province: string;
  provinces: string[];
  onProvince: (province: string) => void;
  city: string;
  cities: string[];
  onCity: (city: string) => void;
  countyProvince: string;
  countyProvinces: string[];
  onCountyProvince: (province: string) => void;
  catalog: PublishedCity[];
  catalogLoading: boolean;
  catalogAvailable: boolean;
  error: string;
  accountName?: string;
  accountLoading: boolean;
  boardRevision: number;
  accountEnabled: boolean;
  onAccount: () => void;
  onStart: () => void;
  reviewCount: number;
  onReview: () => void;
};

const gameNames = { line: '看图猜线路', station: '看通达度猜站名', city: '看线网猜城市', county: '看线网猜县城' };
const control = 'mt-1 block w-full rounded-xl border border-m3-outline-variant/40 bg-m3-surface px-3 py-2.5 text-sm';
const choice = (selected: boolean) => `rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${selected
  ? 'border-m3-primary bg-m3-primary-container text-m3-on-primary-container'
  : 'border-m3-outline-variant/40 bg-m3-surface text-slate-700 hover:bg-m3-surface-container'}`;

type Board = { entries: LeaderboardEntry[]; loading?: boolean; error?: string };
const loadingBoard: Board = { entries: [], loading: true };
const unavailableBoard: Board = { entries: [], error: '排行榜暂不可用' };
const contestsById = new Map<string, Contest>(contests.map(contest => [contest.id, contest]));

function BoardPreview({ contest, board }: { contest: Contest; board: Board }) {
  const leaders = board.entries.filter(entry => entry.rank <= 3).slice(0, 3);
  return <section className="min-w-0">
    <h3 className="mb-2 text-[11px] font-bold text-white/90 sm:text-xs">{gameNames[contest.game]}</h3>
    {leaders.length ? <ol className="space-y-1">
      {leaders.map(entry => <li key={entry.rank} className="flex items-baseline gap-1.5 text-xs">
        <span className="font-bold tabular-nums text-[#f8e3a9]">{entry.rank}</span>
        <span className="min-w-0 flex-1 truncate">{entry.displayName}</span>
        <span className="font-semibold tabular-nums">{entry.score}</span>
      </li>)}
    </ol> : <p className="text-xs text-white/85">{board.loading ? '读取中…' : board.error || '暂无成绩'}</p>}
  </section>;
}

function GameOptions(props: LobbyProps & { competitive: boolean }) {
  const { competitive } = props;
  const mode = competitive ? props.contest.game : props.mode;
  const scope = competitive ? props.contest.scope : props.countyProvince;
  const tagGroups = contestTagGroups(mode);
  const rules = contestRules(mode, props.tags);
  const local = mode === 'line' || mode === 'station';
  const city = competitive ? props.contest.scope : props.city;
  const citywide = isCitywideContest(rules.range);
  const area = citywide ? `${city}全域（含郊区）` : ({
    北京市: '北京市区（东城、西城、海淀、朝阳、丰台、石景山）',
    上海市: '上海市区（黄浦、静安、徐汇、长宁、普陀、虹口、杨浦）',
  } as Record<string, string>)[city] ?? `${city.replace(/市$/, '')}市区`;
  const rangeDescription = {
    urban: '纯数字编号的常规公交',
    special: '常规公交及常见带前后缀的编号线路（排除偏门线路）',
    'all-city': '常规公交及常见带前后缀的编号线路（排除偏门线路）',
    niche: '所有线路名含阿拉伯数字的公交，包括带数字的偏门线路',
    unusual: '所有已收录公交，包括无数字名称的偏门线路',
  }[rules.range];
  const locked = props.catalogLoading || !props.catalogAvailable
    || (competitive && (props.accountLoading || !props.accountEnabled))
    || (!competitive && local && !props.cities.includes(props.city))
    || (mode === 'county' && !props.countyProvinces.includes(scope));
  const base = contestRules(mode, []).multiplier;
  const max = tagGroups.reduce((product, group) => product * Math.max(...group.tags.map(tag => tag.factor)), base);
  const fraction = Math.log(rules.multiplier / base) / Math.log(max / base);
  const tier = rules.multiplier === max ? 'rainbow' : fraction >= .72 ? 'purple' : fraction >= .46 ? 'red' : fraction > 0 ? 'yellow' : 'blue';

  return <section className="space-y-4 rounded-2xl border border-m3-outline-variant/30 bg-m3-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-black">{competitive ? '竞赛标签' : gameNames[mode]}</h2>
      <span className={`contest-multiplier contest-multiplier-${tier}`}><strong>积分倍率 {rules.multiplier}×</strong></span>
    </div>
    {local && <p className="text-xs text-slate-600">默认显示高德底图和站点 · 7 次提示 · 每题 2 分钟 · 选择题</p>}
    {!competitive && mode === 'county' && <label className="block max-w-xs text-xs font-bold">省份
      <select className={control} value={props.countyProvince} onChange={event => props.onCountyProvince(event.target.value)}>
        {props.countyProvinces.map(province => <option key={province} value={province}>{province}</option>)}
      </select>
    </label>}
    {!competitive && local && <>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-bold">省份<select value={props.province} onChange={event => props.onProvince(event.target.value)} className={control}>
          {props.provinces.map(province => <option key={province}>{province}</option>)}
        </select></label>
        <label className="text-xs font-bold">城市<select value={props.city} onChange={event => props.onCity(event.target.value)} className={control}>
          {props.cities.map(city => <option key={city}>{city}</option>)}
        </select></label>
      </div>
      {props.city && !hasContestDistricts(props.city) && (rules.range === 'urban' || rules.range === 'special') &&
        <p className="text-xs text-slate-600">市区范围按已收录站点密集区估算。</p>}
    </>}
    <div className="grid gap-3">
      {tagGroups.map(group => <fieldset key={group.label} className="min-w-0">
        <legend className="mb-1.5 text-xs font-bold text-slate-600">{group.label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {group.tags.map(tag => {
            const selected = props.tags.includes(tag.id);
            return <button key={tag.id} type="button" aria-pressed={selected} className={choice(selected)}
              onClick={() => props.onTags([...props.tags.filter(id => !group.tags.some(item => item.id === id)), ...(selected ? [] : [tag.id])])}>
              {tag.label} <span className="text-m3-primary">{tag.factor}×</span>
            </button>;
          })}
        </div>
        {group.label === '考题范围' && city && <p className="mt-2 text-xs leading-relaxed text-slate-600">
          考题范围包含：{area}内已收录的{mode === 'station' ? '常规公交站点' : rangeDescription}。铁路与地铁除外。
        </p>}
      </fieldset>)}
    </div>
    {props.error && <p role="alert" className="text-sm text-m3-error">{props.error}</p>}
    {!competitive && props.catalogLoading && <p role="status" className="text-sm text-slate-600">正在读取城市…</p>}
    {competitive && !props.accountEnabled && <p role="status" className="text-sm text-slate-600">竞赛服务暂不可用。</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={locked} onClick={competitive && !props.accountName ? props.onAccount : props.onStart}
        className="rounded-xl bg-m3-primary px-5 py-2.5 text-sm font-bold text-m3-on-primary transition-colors hover:bg-[var(--color-m3-on-primary-container)] disabled:opacity-50">
        {competitive ? props.accountName ? '开始竞赛' : '登录参加竞赛' : '开始模拟'}
      </button>
      {props.reviewCount > 0 && <button type="button" onClick={props.onReview} className={choice(false) + ' flex items-center gap-2'}>
        <History size={16} />复盘上局
      </button>}
    </div>
  </section>;
}

export function GameLobby(props: LobbyProps) {
  const [showRules, setShowRules] = useState(false);
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [refresh, setRefresh] = useState(0);
  const reduceMotion = useReducedMotion();
  const pane = useRef<HTMLElement>(null);
  const competitive = props.division === 'contest';
  const region = contestRegions.find(item => item.id === props.regionId);
  const regionContests = region?.contests.map(id => contestsById.get(id)!) ?? [];
  const boardFor = (id: string) => props.accountEnabled ? boards[id] ?? loadingBoard : unavailableBoard;
  const { accountEnabled, accountName, accountLoading, boardRevision } = props;

  useEffect(() => {
    if (!competitive || !accountEnabled || accountLoading) return;
    let active = true;
    setBoards({});
    for (const { id, game, scope } of contests) {
      void getContestLeaderboard(game, scope).then(
        result => { if (active) setBoards(previous => ({ ...previous, [id]: { entries: result.entries } })); },
        () => { if (active) setBoards(previous => ({ ...previous, [id]: unavailableBoard })); },
      );
    }
    return () => { active = false; };
  }, [competitive, accountEnabled, accountName, accountLoading, boardRevision, refresh]);

  const showRegion = (next: (typeof contestRegions)[number]) => {
    const existing = next.contests.some(id => id === props.contest.id);
    if (!existing) props.onContest(contestsById.get(next.contests[0])!);
    props.onRegion(next.id);
    pane.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' });
  };

  return <main ref={pane} className="absolute inset-0 z-[90] overflow-y-auto bg-m3-background text-m3-on-surface">
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="/" aria-label="返回地图" title="返回地图" className="rounded-full bg-m3-surface p-2.5 text-m3-primary shadow-sm"><ArrowLeft size={20} /></a>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">巴士猜线</h1>
        </div>
        {props.accountEnabled && <button type="button" onClick={props.onAccount} className={choice(false)}>
          {props.accountLoading ? '正在确认登录' : props.accountName ?? '登录'}
        </button>}
      </header>
      <nav aria-label="游戏大厅" className="my-6 flex justify-center sm:my-8">
        <div className="flex gap-1 rounded-2xl border border-m3-outline-variant/30 bg-m3-surface p-1 shadow-sm">
          {(['contest', 'simulation'] as const).map(division => <button
            key={division} type="button" aria-pressed={props.division === division}
            onClick={() => props.onDivision(division)} className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-colors sm:px-8 ${props.division === division
              ? 'bg-m3-primary text-m3-on-primary' : 'text-m3-primary hover:bg-m3-primary-container'}`}>
            {division === 'contest' ? <><Trophy size={17} />竞赛</> : <><Gamepad2 size={17} />模拟</>}
          </button>)}
        </div>
      </nav>
      {competitive ? <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-black text-m3-primary sm:text-xl">{contestSeason} 赛季</h2>
          {region && <button type="button" onClick={() => props.onRegion(null)}
            className={choice(false) + ' flex items-center gap-1.5'}><ArrowLeft size={16} />返回竞赛大厅</button>}
          {!region && props.reviewCount > 0 && <button type="button" onClick={props.onReview}
            className={choice(false) + ' flex items-center gap-1.5'}><History size={16} />复盘上局</button>}
        </div>
        <LayoutGroup id={contestSeason}>
          {region ? <motion.article layoutId={reduceMotion ? undefined : `region-${region.id}`}
            key={region.id} className="contest-card grid items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:gap-5 sm:p-6"
            style={{ borderRadius: 24 }}>
            <div className="contest-region-map lg:sticky lg:top-4">
              <ContestNetworkMap catalog={props.catalog} region={region} loading={props.catalogLoading} />
            </div>
            <motion.div className="min-w-0 space-y-4" initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }} transition={{ duration: .25, delay: reduceMotion ? 0 : .12 }}>
              <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{region.title}</h2>
              <div className="rounded-2xl bg-m3-surface p-3 text-m3-on-surface">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <h3 className="text-sm font-black">竞赛排行榜</h3>
                  {props.accountEnabled && <button type="button" onClick={() => setRefresh(value => value + 1)}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-m3-primary hover:bg-m3-primary-container">刷新</button>}
                </div>
                <div className={`grid gap-2 ${regionContests.length > 1 ? 'min-[440px]:grid-cols-2' : ''}`}>
                  {regionContests.map(contest => {
                    const board = boardFor(contest.id);
                    return board.error ? <p key={contest.id} className="rounded-xl bg-m3-surface-container-low p-3 text-xs text-slate-600">
                      <strong className="mb-2 block text-m3-on-surface">{gameNames[contest.game]}</strong>{board.error}
                    </p> : <GameLadderPanel key={contest.id} title={gameNames[contest.game]} entries={board.entries} loading={board.loading} />;
                  })}
                </div>
              </div>
              {regionContests.length > 1 ? <div role="group" aria-label="竞赛项目" className="grid grid-cols-2 gap-2">
                {regionContests.map(contest => <button key={contest.id} type="button"
                  aria-pressed={props.contest.id === contest.id} onClick={() => props.onContest(contest)}
                  className={`rounded-xl border px-2 py-2.5 text-xs font-bold transition-colors sm:text-sm ${props.contest.id === contest.id
                    ? 'border-m3-surface bg-m3-surface text-m3-primary'
                    : 'border-white/40 bg-white/10 text-white hover:bg-white/20'}`}>{gameNames[contest.game]}</button>)}
              </div> : <h3 className="text-base font-bold text-white">{gameNames[props.contest.game]}</h3>}
              <GameOptions {...props} competitive />
            </motion.div>
          </motion.article> : <div className="grid gap-4 md:grid-cols-2 sm:gap-5">
            {contestRegions.map(item => <motion.article key={item.id}
              layoutId={reduceMotion ? undefined : `region-${item.id}`} style={{ borderRadius: 24 }}
              className="contest-card contest-preview group relative grid min-h-48 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 p-3 sm:min-h-56 sm:gap-5 sm:p-4">
              <ContestCardOutline region={item.id} />
              <div className="relative col-start-2 flex min-w-0 flex-col py-1 pr-1 text-white">
                <h3 className="mb-3 text-right text-2xl font-black tracking-tight sm:mb-5 sm:text-4xl">{item.title}</h3>
                <div className={`grid gap-x-3 gap-y-2 ${item.contests.length > 1 ? 'min-[365px]:grid-cols-2' : ''}`}>
                  {item.contests.map(id => <BoardPreview key={id} contest={contestsById.get(id)!} board={boardFor(id)} />)}
                </div>
                <ArrowUpRight aria-hidden="true" size={27} className="ml-auto mt-auto pt-1 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <button type="button" aria-label={`展开${item.title}竞赛`} onClick={() => showRegion(item)}
                className="absolute inset-0 z-10 rounded-[24px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-m3-primary" />
            </motion.article>)}
          </div>}
        </LayoutGroup>
      </> : <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <section aria-label="选择项目" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {(Object.entries(gameNames) as [GameMode, string][]).map(([game, title]) => <button
            key={game} type="button" onClick={() => props.onMode(game)} aria-pressed={props.mode === game}
            className={choice(props.mode === game) + ' flex items-center gap-2 text-left'}>
            <GameModeVisual mode={game} active={props.mode === game} />{title}
          </button>)}
          <p className="px-2 text-xs text-slate-600">本机最佳 {props.bestScore} 分</p>
          {props.reviewCount > 0 && <button type="button" onClick={props.onReview} className={choice(false) + ' flex items-center gap-2'}>
            <History size={16} />复盘上局
          </button>}
        </section>
        <GameOptions {...props} competitive={false} />
      </div>}
      {competitive && <footer className="mt-7 space-y-1.5 px-1 pb-6 text-xs leading-relaxed text-slate-600">
        <p>1.参与竞赛需要您登录巴士线路图账号</p>
        <p>2.参与竞赛则代表您已知晓<button type="button" aria-expanded={showRules} onClick={() => setShowRules(value => !value)} className="underline">《“巴士猜线”公平游戏条例》</button>相关内容，若我们发现您的游戏行为违反了此条例，您将不再被允许参与巴士猜线的竞赛项目</p>
        {showRules && <p className="mt-2 rounded-xl bg-m3-surface p-3">请独立作答。禁止使用脚本自动答题、读取隐藏题目数据或篡改比赛成绩。违反条例的账号将失去竞赛资格。</p>}
      </footer>}
    </div>
  </main>;
}
