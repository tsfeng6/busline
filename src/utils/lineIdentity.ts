/** Ignore optional 路 and spacing, while retaining the district/prefix and variants. */
export function lineBaseIdentity(name: string): string {
  return name.normalize('NFKC').split(/[（(#]/)[0].replace(/\s+/g, '').replace(/路$/, '').toUpperCase();
}

export function matchesLineQuery(query: string, name: string): boolean {
  if (/[（(]/.test(query)) {
    return query.normalize('NFKC').replace(/\s+/g, '') === name.normalize('NFKC').replace(/\s+/g, '');
  }
  return lineBaseIdentity(query) === lineBaseIdentity(name);
}

export function matchesReturnedLine(query: string, line: { name: string; sourceQueries?: string[] }): boolean {
  return matchesLineQuery(query, line.name)
    || !!line.sourceQueries?.some(source => matchesLineQuery(query, source));
}
