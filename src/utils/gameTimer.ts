export function getGameTimeLimit(mode: 'line' | 'station' | 'city' | 'county', difficulty: 'easy' | 'medium' | 'hard' | 'hell'): number | null {
  if (mode === 'city' || mode === 'county') return 180;
  // The two redesigned ladder modes are per-question challenges.  A new
  // question resets this amount after loading, rather than spending one timer
  // across the whole run.
  return difficulty === 'hell' ? 90 : 120;
}

export function formatGameTime(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
