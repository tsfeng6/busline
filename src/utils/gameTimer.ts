export function getGameTimeLimit(mode: 'line' | 'station' | 'city' | 'county', difficulty: 'easy' | 'medium' | 'hard' | 'hell'): number | null {
  if (mode === 'city' || mode === 'county') return 180;
  return { easy: 120, medium: 180, hard: 300, hell: null }[difficulty];
}

export function formatGameTime(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
