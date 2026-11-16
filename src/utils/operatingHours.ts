export const SCHEDULE_DATA_VERSION = 3;

export function formatOperatingTime(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let text = String(value).trim();
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2400) text = text.padStart(4, '0');
  // Accept compact API times, colon times, and date-prefixed serialized times.
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/)
    || text.match(/^(\d{2})(\d{2})$/)
    || text.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The SDK can return empty stime/etime while timedesc contains the full timetable. */
export function parseTimeDescription(value: unknown): { first?: string; last?: string; description?: string } {
  let data: any = value;
  if (typeof data === 'string') {
    for (let pass = 0; pass < 3; pass++) {
      try { data = JSON.parse(data); break; }
      catch {
        try { const decoded = decodeURIComponent(data); if (decoded === data) return {}; data = decoded; }
        catch { return {}; }
      }
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const groups = Array.isArray(data.rule_group) ? data.rule_group : [];
  const schedules = groups.map((group: any) => {
    const ranges = (Array.isArray(group.time_group) ? group.time_group : []).map((range: any) => ({
      first: formatOperatingTime(range.start_time), last: formatOperatingTime(range.end_time),
    })).filter((range: any) => range.first || range.last);
    const date = group.date || {};
    const universal = (!date.day_type?.length || date.day_type.includes('all')) &&
      (!date.month_type?.length || date.month_type.includes('all')) &&
      !date.day_month?.length && !date.day_week?.length && !date.month?.length && !date.day_range && !date.month_range;
    return { ranges, universal, remark: typeof group.remark === 'string' ? group.remark : '' };
  }).filter((group: any) => group.ranges.length);
  const universal = schedules.filter((group: any) => group.universal);
  const selected = universal.length ? universal : schedules;
  const description = typeof data.allRemark === 'string' ? data.allRemark : schedules.map((group: any) => group.remark).filter(Boolean).join('；');
  // Do not silently merge different weekday/season schedules into a fictitious timetable.
  const signatures = new Set(selected.map((group: any) => JSON.stringify(group.ranges)));
  if (!universal.length && signatures.size > 1) return { description: description || '分日期运营，请查看运营方时刻表' };
  const ranges = selected[0]?.ranges || [];
  const starts = ranges.map((range: any) => range.first).filter(Boolean).sort();
  // Preserve cross-midnight final departures by comparing times relative to the first departure.
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const first = starts[0];
  const ends = ranges.map((range: any) => range.last).filter(Boolean).sort((a: string, b: string) => {
    const relative = (time: string) => toMinutes(time) + (first && toMinutes(time) < toMinutes(first) ? 1440 : 0);
    return relative(a) - relative(b);
  });
  return { first, last: ends.at(-1), description: description || undefined };
}

export function getOperatingHours(line: any) {
  const detail = parseTimeDescription(line.timedesc);
  return {
    stime: formatOperatingTime(line.stime) || formatOperatingTime(line.start_time) || detail.first,
    etime: formatOperatingTime(line.etime) || formatOperatingTime(line.end_time) || detail.last,
    scheduleDescription: detail.description || line.scheduleDescription,
    scheduleFetched: true,
    scheduleDataVersion: SCHEDULE_DATA_VERSION,
  };
}
