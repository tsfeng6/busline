type Mode = 'line' | 'station' | 'city' | 'county';

export function GameModeVisual({ mode, active }: { mode: Mode; active?: boolean }) {
  const ink = active ? '#f7fffb' : '#315e57';
  const mint = active ? '#aee6d0' : '#70b59f';
  const blue = active ? '#c9e9ff' : '#4c91b7';
  const coral = active ? '#ffd0c2' : '#d87862';
  const rail = { fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <div aria-hidden="true" className={`relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border ${active ? 'border-white/20 bg-[#376f65] shadow-inner' : 'border-[#d6e6df] bg-[#eff6f2]'}`}>
    <span className="absolute inset-2 rounded-xl border border-dashed border-current opacity-15" />
    <svg viewBox="0 0 112 88" className="relative h-[58px] w-[74px]">
      {mode === 'line' && <><path {...rail} d="M11 68H34Q43 68 43 58V32Q43 19 57 19H100" stroke={ink} strokeWidth="6" /><path {...rail} d="M11 68H34Q43 68 43 58V32Q43 19 57 19H100" stroke={mint} strokeWidth="2" strokeDasharray="2 7" />{[11, 43, 69, 100].map((x, i) => <circle key={x} cx={x} cy={i === 0 ? 68 : i === 1 ? 48 : 19} r="4" fill={i === 2 ? coral : ink} stroke={active ? '#376f65' : '#eff6f2'} strokeWidth="2" />)}<path {...rail} d="M8 34H26M74 72H100" stroke={blue} strokeWidth="2" opacity=".55" /></>}
      {mode === 'station' && <><path {...rail} d="M8 16L102 75" stroke={mint} strokeWidth="5" /><path {...rail} d="M7 52H105" stroke={blue} strokeWidth="5" /><path {...rail} d="M66 8V82" stroke={coral} strokeWidth="5" /><circle cx="66" cy="52" r="9" fill={active ? '#376f65' : '#eff6f2'} stroke={ink} strokeWidth="3" /><circle cx="66" cy="52" r="3" fill={ink} />{[20, 91, 66].map((x, i) => <circle key={x} cx={x} cy={i === 0 ? 24 : i === 1 ? 52 : 17} r="3" fill={ink} />)}</>}
      {mode === 'city' && <><rect x="10" y="10" width="92" height="68" rx="16" fill="none" stroke={ink} strokeWidth="3" opacity=".75" /><path {...rail} d="M16 32H96M16 55H96M32 16V73M57 16V73M82 16V73" stroke={ink} strokeWidth="2.5" opacity=".35" /><path {...rail} d="M14 58H39Q47 58 47 50V25H96" stroke={mint} strokeWidth="5" /><path {...rail} d="M23 18V38Q23 46 31 46H95" stroke={blue} strokeWidth="5" /><path {...rail} d="M15 68H69Q77 68 77 60V18" stroke={coral} strokeWidth="4" /></>}
      {mode === 'county' && <><path d="M19 23Q33 8 59 12Q88 10 99 33Q105 58 84 73Q57 85 28 71Q8 54 19 23Z" fill={active ? '#2d5f56' : '#dcece5'} stroke={ink} strokeWidth="3" /><path {...rail} d="M18 45H92M33 20V72M68 19V68M28 68Q51 55 59 45" stroke={mint} strokeWidth="4" /><path {...rail} d="M22 58H83" stroke={blue} strokeWidth="3" /><circle cx="59" cy="45" r="5" fill={coral} stroke={active ? '#2d5f56' : '#dcece5'} strokeWidth="2" /></>}
    </svg>
  </div>;
}
