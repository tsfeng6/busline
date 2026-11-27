import { fullContestRouteName } from './contestRouteName';
import type { GameMode } from './offlineGame';

export function isGameAnswerCorrect(answer: string, correctAnswer: string, isFillIn: boolean, mode: GameMode | null, preserveRouteQualifier = false): boolean {
  const rawUser = answer.trim(), rawCorrect = correctAnswer.trim();
  let isCorrect = rawUser === rawCorrect;

  if (!isCorrect && isFillIn) {
    const toHalfWidth = (s: string) =>
      s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
    const norm = (s: string) => {
      const input = toHalfWidth(s);
      const text = mode === 'line' && preserveRouteQualifier
        ? fullContestRouteName(input).replace(/[()]/g, '')
        : input.replace(/\(.*?\)/g, '');
      return text
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[·\-—_.,，。、'"“”‘’]/g, '');
    };

    const u = norm(rawUser);
    const c = norm(rawCorrect);

    if (!u) {
      isCorrect = false;
    } else if (mode === 'line') {
      const normLineName = (s: string) =>
        s
          .replace(/快速直达专线/g, '快直')
          .replace(/快速直达/g, '快直')
          .replace(/快速公交/g, '快')
          .replace(/([内外])环/g, '$1')
          .replace(/(?:公交|巴士|专线|路线|快车|班车|区间车|车|路|线)/g, (m) => {
            if (m === '快车') return '快';
            if (m === '专线') return '专';
            if (m === '区间车') return '区间';
            return '';
          });
      const nu = normLineName(u);
      const nc = normLineName(c);
      isCorrect = u === c || (nu.length > 0 && nu === nc);
    } else if ((mode === 'station' || mode === 'accessibility')) {
      const stripStationEnd = (s: string) => {
        const stripped = s.replace(
          /(?:公交枢纽站|公交场站|公交总站|公交车站|公交站|枢纽站|首末站|总站|车站|站)$/,
          ''
        );
        return stripped || s;
      };
      const stripStationAll = (s: string) => {
        let res = stripStationEnd(s).replace(/^(?:地铁|公交)/, '');
        res = res.replace(/(?:火车站|高铁站|汽车站|地铁站)$/, '') || res;
        return res || s;
      };
      const u1 = stripStationEnd(u);
      const c1 = stripStationEnd(c);
      const u2 = stripStationAll(u);
      const c2 = stripStationAll(c);
      isCorrect = u === c || u1 === c1 || (u2.length >= 2 && u2 === c2);
    } else if (mode === 'county') {
      const stripCountySuffix = (s: string) => {
        const stripped = s
          .replace(/(?:[一-龥]{1,8}?(?:族|各族))*自治(?:县|州|旗)$/, '')
          .replace(/(?:特别行政区|行政委员会|林区|矿区|新区|特区|[县市区旗盟])$/, '');
        return stripped || s;
      };
      isCorrect = u === c || stripCountySuffix(u) === stripCountySuffix(c);
    } else if (mode === 'city') {
      const stripCitySuffix = (s: string) => {
        const stripped = s
          .replace(/(?:[一-龥]{1,8}?(?:族|各族))*自治州$/, '')
          .replace(/(?:特别行政区|地区|[市盟])$/, '');
        return stripped || s;
      };
      isCorrect = u === c || stripCitySuffix(u) === stripCitySuffix(c);
    }
  }
  return isCorrect;
}
