const endpointSeparator = /^(.+?)(?:--+|—+|→|↔)(.+)$/s;

function matchRouteEndpoints(detail: string) {
  const normalized = detail.normalize('NFKC').trim();
  // Operating notes may contain a time range with the same separator as stops.
  if (/^(?:工作日|非工作日|节假日|双休日|周[一二三四五六日天]|早高峰|晚高峰|高峰期间|仅在|仅限)/.test(normalized) ||
      /\d{1,2}:\d{2}/.test(normalized)) return null;
  return normalized.match(endpointSeparator);
}

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
  return matchRouteEndpoints(detail) !== null;
}

export function contestRouteEndpoints(name: string) {
  const groups = routeAnnotations(name) ?? [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const match = matchRouteEndpoints(groups[index].detail);
    if (match) return { start: match[1].trim(), end: match[2].trim() };
  }
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
