const endpointSeparator = /^.+?(?:--+|—+|→|↔).+$/s;

export function routeAnnotations(name: string) {
  const groups: { start: number; end: number; detail: string }[] = [];
  let depth = 0;
  let start = 0;
  for (const { 0: bracket, index } of name.matchAll(/[()（）]/g)) {
    if (bracket === '(' || bracket === '（') {
      if (depth++ === 0) start = index;
    } else {
      if (depth === 0) return null;
      if (--depth === 0) groups.push({ start, end: index + 1, detail: name.slice(start + 1, index).trim() });
    }
  }
  return depth === 0 ? groups : null;
}

export function isRouteEndpointAnnotation(detail: string) {
  return endpointSeparator.test(detail.normalize('NFKC'));
}

export function fullContestRouteName(name: string) {
  const label = name.replace(/#\d+$/, '').trim();
  const groups = routeAnnotations(label);
  if (!groups) return label;
  let answer = '';
  let position = 0;
  for (const { start, end, detail } of groups) {
    if (!isRouteEndpointAnnotation(detail)) continue;
    answer += label.slice(position, start);
    position = end;
  }
  return (answer + label.slice(position)).trim();
}
