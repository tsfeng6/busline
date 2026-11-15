/** Reveal one character at each end per hint, counting Unicode code points. */
export function getGameHint(answer: string, hintsUsed: number): string {
  const chars = Array.from(answer);
  // Short answers retain their length-only first hint, rather than giving them away.
  const revealedAtEachEnd = chars.length <= 2
    ? (hintsUsed >= 2 ? chars.length : 0)
    : Math.max(0, hintsUsed);
  return chars.map((char, index) =>
    index < revealedAtEachEnd || index >= chars.length - revealedAtEachEnd ? char : '？'
  ).join('');
}

export function isGameHintComplete(answer: string, hintsUsed: number): boolean {
  return hintsUsed >= (Array.from(answer).length <= 2 ? 2 : Math.ceil(Array.from(answer).length / 2));
}
