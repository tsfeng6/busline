import type { GameMode } from './offlineGame';

export function getContestTotalTime(mode: GameMode | null, competitive: boolean): number | null {
  return mode === 'accessibility' ? 60 * 60 : competitive ? 20 * 60 : null;
}

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

export function recordGameAnswer<T>(
  pending: { current: T | null }, userAnswer: string, isCorrect: boolean, timedOut = false,
) {
  const question = pending.current;
  if (!question) return null;
  pending.current = null;
  return { ...question, userAnswer, isCorrect, timedOut };
}
