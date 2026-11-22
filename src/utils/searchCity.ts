/** Empty arrays are used for missing administrative fields in some SDK results. */
export function resolveSearchCity(address: any): string {
  const city = typeof address?.city === 'string' ? address.city.trim() : '';
  if (city) return city;
  const province = typeof address?.province === 'string' ? address.province.trim() : '';
  return ['北京市', '上海市', '天津市', '重庆市'].includes(province) ? province : '';
}

/** Municipality results often place their districts beneath a city-level grouping. */
export function districtSearchScopes(children: any[]): string[] {
  return [...new Set(children.flatMap(child => {
    const code = typeof child?.adcode === 'string' ? child.adcode : '';
    if (!/^\d{6}$/.test(code)) return [];
    if (child.level === 'district') return [code];
    if (child.level !== 'city') return [];
    const nested = child.districtList ?? child.districts;
    const scopes = Array.isArray(nested) ? districtSearchScopes(nested) : [];
    return scopes.length ? scopes : [code];
  }))];
}
