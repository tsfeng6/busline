import type { LeaderboardEntry } from '../utils/gameAccount';

const initials = (name: string) => /^[A-Za-z]/.test(name) ? (name.match(/[A-Za-z]/g)?.join('').slice(0, 2).toUpperCase() || '玩') : name.slice(0, 1) || '玩';

export function GameLadderPanel({ title, entries, loading }: { title: string; entries: LeaderboardEntry[]; loading?: boolean }) {
  const top = entries.filter(entry => entry.rank <= 5).slice(0, 5);
  const current = entries.find(entry => entry.isCurrentUser);
  return <section className="min-w-0 rounded-2xl bg-m3-surface-container-low p-3">
    <h3 className="mb-2 text-xs font-black text-slate-800">{title}</h3>
    <div className="space-y-1.5">
      {loading ? <p className="py-5 text-center text-[11px] font-bold text-slate-400">读取中…</p> : top.length ? top.map(entry => <div key={`${entry.rank}-${entry.displayName}`} className="flex items-center gap-2 text-[11px]">
        <span className="w-4 text-center font-black text-m3-primary">{entry.rank}</span>
        {entry.avatarUrl ? <img src={entry.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-m3-primary text-[9px] font-black text-white">{initials(entry.displayName)}</span>}
        <span className="min-w-0 flex-1 truncate font-bold text-slate-700">{entry.displayName}</span><span className="font-black text-m3-primary">{entry.score}</span>
      </div>) : <p className="py-5 text-center text-[11px] font-bold text-slate-400">暂无成绩</p>}
      {top.length >= 5 && <p className="pl-6 text-xs font-black tracking-[0.3em] text-slate-400">…</p>}
    </div>
    <div className="mt-2 border-t border-m3-outline-variant/30 pt-2 text-[11px] font-bold text-slate-600">我的排名 <span className="ml-1 font-black text-slate-900">{current ? `#${current.rank}` : '--'}</span><span className="float-right font-black text-m3-primary">{current ? `${current.score} 分` : '-- 分'}</span></div>
  </section>;
}
