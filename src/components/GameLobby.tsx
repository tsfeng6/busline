import { ArrowLeft, Gamepad2, History, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { contestRules, contestTagGroups, contests } from '../utils/contestRules';
import { getContestLeaderboard, type LeaderboardEntry } from '../utils/gameAccount';
import type { GameMode } from '../utils/offlineGame';
import { GameLadderPanel } from './GameLadderPanel';
import { GameModeVisual } from './GameModeVisual';

type LobbyProps = {
  division: 'contest' | 'simulation';
  onDivision: (division: 'contest' | 'simulation') => void;
  contest: (typeof contests)[number];
  onContest: (contest: (typeof contests)[number]) => void;
  tags: string[];
  onTags: (tags: string[]) => void;
  mode: GameMode;
  onMode: (mode: GameMode) => void;
  difficulty: 'easy' | 'medium' | 'hard' | 'hell';
  bestScore: number;
  onDifficulty: (difficulty: 'easy' | 'hell') => void;
  province: string;
  provinces: string[];
  onProvince: (province: string) => void;
  city: string;
  cities: string[];
  onCity: (city: string) => void;
  countyProvince: string;
  countyProvinces: string[];
  onCountyProvince: (province: string) => void;
  catalogLoading: boolean;
  catalogAvailable: boolean;
  error: string;
  accountName?: string;
  accountLoading: boolean;
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

function ContestBoard({ game, scope, accountName }: { game: GameMode; scope: string; accountName?: string }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getContestLeaderboard(game, scope).then(result => {
      if (active) setEntries(result.entries);
    }, () => {
      if (active) setError('暂时无法读取排行榜。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [game, scope, accountName, refresh]);
  return <aside className="space-y-2 rounded-2xl border border-m3-outline-variant/30 bg-m3-surface p-3">
    <div className="flex items-center justify-between px-2 text-xs font-bold text-slate-600">
      <span>{scope}榜</span>
      <button type="button" className="rounded-lg px-2 py-1 text-m3-primary" onClick={() => setRefresh(value => value + 1)}>刷新</button>
    </div>
    {error ? <p role="status" className="p-3 text-sm text-slate-600">{error}</p>
      : <GameLadderPanel title="竞赛排行榜" entries={entries} loading={loading} />}
  </aside>;
}

export function GameLobby(props: LobbyProps) {
  const [showRules, setShowRules] = useState(false);
  const competitive = props.division === 'contest';
  const mode = competitive ? props.contest.game : props.mode;
  const scope = mode === 'county' ? props.countyProvince : props.contest.scope;
  const rules = contestRules(props.contest.game, props.tags);
  const local = mode === 'line' || mode === 'station';
  const locked = competitive
    ? props.accountLoading || !props.accountEnabled || (mode === 'county' && !props.countyProvinces.includes(scope))
    : props.catalogLoading || !props.catalogAvailable || (local && !props.cities.includes(props.city))
      || (mode === 'county' && !props.countyProvinces.includes(scope));
  return <main className="absolute inset-0 z-[90] overflow-y-auto bg-m3-surface-container-low text-slate-900">
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="/" aria-label="返回地图" title="返回地图" className="rounded-full bg-m3-surface p-2.5 text-m3-primary shadow-sm"><ArrowLeft size={20} /></a>
          <h1 className="text-2xl font-black sm:text-3xl">巴士竞猜</h1>
        </div>
        {props.accountEnabled && <button type="button" onClick={props.onAccount} className={choice(false)}>
          {props.accountLoading ? '正在确认登录' : props.accountName ?? '登录'}
        </button>}
      </header>
      <nav aria-label="游戏大厅" className="mb-5 flex gap-2">
        {(['contest', 'simulation'] as const).map(division => <button
          key={division} type="button" aria-pressed={props.division === division}
          onClick={() => props.onDivision(division)} className={choice(props.division === division) + ' flex items-center gap-2 px-5'}>
          {division === 'contest' ? <><Trophy size={17} />竞赛</> : <><Gamepad2 size={17} />模拟</>}
        </button>)}
      </nav>
      <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <section aria-label="选择项目" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {competitive ? contests.map(contest => <button key={contest.id} type="button" onClick={() => props.onContest(contest)}
            aria-pressed={contest.id === props.contest.id} className={choice(contest.id === props.contest.id) + ' flex items-center gap-2 text-left'}>
            <GameModeVisual mode={contest.game} active={contest.id === props.contest.id} />{contest.title}
          </button>) : (Object.entries(gameNames) as [GameMode, string][]).map(([game, title]) => <button
            key={game} type="button" onClick={() => props.onMode(game)} aria-pressed={mode === game}
            className={choice(mode === game) + ' flex items-center gap-2 text-left'}>
            <GameModeVisual mode={game} active={mode === game} />{title}
          </button>)}
        </section>
        <section className="space-y-4 rounded-2xl border border-m3-outline-variant/30 bg-m3-surface p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-black">{competitive ? props.contest.title : gameNames[mode]}</h2>
            {competitive ? <strong className="rounded-lg bg-m3-primary-container px-2.5 py-1 tabular-nums text-m3-on-primary-container">积分 {rules.multiplier}×</strong>
              : <span className="text-xs text-slate-600">本机最佳 {props.bestScore} 分</span>}
          </div>
          {competitive && local && <p className="text-xs text-slate-600">默认市区常规线路 · 显示底图和站点 · 7 次提示 · 每题 2 分钟 · 选择题</p>}
          {mode === 'county' && <label className="block max-w-xs text-xs font-bold">省份
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
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={props.difficulty !== 'hell'} className={choice(props.difficulty !== 'hell')} onClick={() => props.onDifficulty('easy')}>标准（选择题）</button>
              <button type="button" aria-pressed={props.difficulty === 'hell'} className={choice(props.difficulty === 'hell')} onClick={() => props.onDifficulty('hell')}>地狱（填空题）</button>
            </div>
          </>}
          {competitive && <div className="grid gap-3">
            {contestTagGroups(mode).map(group => <fieldset key={group.label} className="min-w-0">
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
            </fieldset>)}
          </div>}
          {props.error && <p role="alert" className="text-sm text-m3-error">{props.error}</p>}
          {!competitive && props.catalogLoading && <p role="status" className="text-sm text-slate-600">正在读取城市…</p>}
          {competitive && !props.accountEnabled && <p role="status" className="text-sm text-slate-600">竞赛服务暂不可用。</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={locked} onClick={competitive && !props.accountName ? props.onAccount : props.onStart}
              className="rounded-xl bg-m3-primary px-5 py-2.5 text-sm font-bold text-m3-on-primary disabled:opacity-50">
              {competitive ? props.accountName ? '开始竞赛' : '登录参加竞赛' : '开始模拟'}
            </button>
            {props.reviewCount > 0 && <button type="button" onClick={props.onReview} className={choice(false) + ' flex items-center gap-2'}>
              <History size={16} />复盘上局
            </button>}
          </div>
          {competitive && props.accountEnabled && scope && <ContestBoard key={`${mode}:${scope}`} game={mode} scope={scope} accountName={props.accountName} />}
        </section>
      </div>
      {competitive && <footer className="mt-4 space-y-1 px-1 pb-6 text-xs leading-relaxed text-slate-600">
        <p>1.参与竞赛需要您登录巴士线路图账号</p>
        <p>2.参与竞赛则代表您已知晓<button type="button" aria-expanded={showRules} onClick={() => setShowRules(value => !value)} className="underline">《“巴士竞猜”公平游戏条例》</button>相关内容，若我们发现您的游戏行为违反了此条例，您将不再被允许参与巴士竞猜的竞赛项目</p>
        {showRules && <p className="mt-2 rounded-xl bg-m3-surface p-3">请独立作答。禁止使用脚本自动答题、读取隐藏题目数据或篡改比赛成绩。违反条例的账号将失去竞赛资格。</p>}
      </footer>}
    </div>
  </main>;
}
