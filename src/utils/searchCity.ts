/** Empty arrays are used for missing administrative fields in some SDK results. */
export function resolveSearchCity(address: any): string {
  const city = typeof address?.city === 'string' ? address.city.trim() : '';
  if (city) return city;
  const province = typeof address?.province === 'string' ? address.province.trim() : '';
  return ['北京市', '上海市', '天津市', '重庆市'].includes(province) ? province : '';
}
