import type { GameMode } from '../utils/offlineGame';

export function GameModeVisual({ mode, active }: { mode: GameMode; active?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-m3-primary ${active ? 'bg-m3-surface' : 'bg-m3-surface-container-low'}`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {mode === 'line' && <>
          <path d="M7 24h5a4 4 0 0 0 4-4v-8a4 4 0 0 1 4-4h7m-4-4 4 4-4 4" />
          <circle cx="5" cy="24" r="2" />
          <circle cx="16" cy="16" r="1.6" className="fill-m3-surface" />
        </>}
        {mode === 'station' && <>
          <path d="M24 13c0 5-8 13-8 13S8 18 8 13a8 8 0 1 1 16 0Z" />
          <circle cx="16" cy="13" r="2.6" />
        </>}
        {mode === 'accessibility' && <>
          <path d="M4 7l9 6m6 6 9 6M4 23l9-5m6-4 9-5M16 4v8m0 8v8" />
          <circle cx="16" cy="16" r="4" />
          <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
        </>}
        {mode === 'city' && <>
          <path d="M5 11h22M5 21h22M11 5v22M21 5v22" />
          <path d="M5 21h6v-5h10v-5h6" strokeWidth="2.8" />
        </>}
        {mode === 'county' && <>
          <circle cx="16" cy="16" r="11.5" strokeDasharray="2 3" />
          <path d="M8 18h6l5-6h5m-10 6 5 5" />
          <circle cx="14" cy="18" r="1.9" className="fill-m3-surface" />
        </>}
      </svg>
    </span>
  );
}
