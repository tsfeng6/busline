export type SuggestionKind = 'line' | 'station' | 'place';
export function getSuggestionKind(tip: any): SuggestionKind {
  if (tip?.type === 'busline' || tip?.type === 'userLine' || tip?.isUserSubmitted) return 'line';
  const code = String(tip?.typecode || '');
  if (tip?.type === 'busstop' || /^150[57]/.test(code) || /公交站|公交车站|公交枢纽|公交场站|地铁.*站/.test(tip?.name || '')) return 'station';
  return 'place';
}
export function rankSearchSuggestions(tips: any[], query: string): any[] {
  const normalize = (name: string) => name.split(/[（(]/)[0].replace(/路|\s/g, '').toLowerCase();
  const key = normalize(query);
  const matchRank = (tip: any) => {
    const name = normalize(String(tip.name || ''));
    return name === key ? 0 : name.startsWith(key) ? 1 : 2;
  };
  return [...tips].sort((a, b) => Number(getSuggestionKind(a) === 'place') - Number(getSuggestionKind(b) === 'place') || matchRank(a) - matchRank(b));
}
