export function GameModeVisual({ mode, active }: { mode: 'line' | 'station' | 'city' | 'county'; active?: boolean }) {
  const color = active ? '#ffffff' : '#4f7d74';
  const common = { fill: 'none', stroke: color, strokeWidth: 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <div aria-hidden="true" className={`flex h-16 w-20 shrink-0 items-center justify-center rounded-2xl ${active ? 'bg-m3-primary' : 'bg-[#e6efeb]'}`}>
    <svg viewBox="0 0 100 80" className="h-14 w-[72px]">
      {mode === 'line' && <path {...common} d="M13 61H44Q57 61 57 48V20Q57 12 66 12H89" />}
      {mode === 'station' && <><path {...common} d="M14 17L86 64" /><path {...common} d="M12 43H88" /><path {...common} d="M55 9V71" /><circle cx="55" cy="43" r="6" fill={color} /></>}
      {mode === 'city' && <><path {...common} d="M15 23V12H40M61 12H86V26M86 54V68H62M39 68H15V54" /><path {...common} d="M18 38H82M31 21V61M53 15V59M15 55H84" /></>}
      {mode === 'county' && <><path {...common} d="M23 18Q50 5 77 22Q91 40 78 62Q48 78 22 58Q8 40 23 18Z" /><path {...common} d="M19 40H82M27 53H75M36 17V64M61 19V60M30 63Q50 51 59 40" /></>}
    </svg>
  </div>;
}
