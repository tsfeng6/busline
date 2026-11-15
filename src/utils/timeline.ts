import { formatOperatingTime } from './operatingHours';
export function isLineOperating(line: { stime?: unknown; etime?: unknown }, minute: number): boolean | null {
  const first = formatOperatingTime(line.stime), last = formatOperatingTime(line.etime);
  if (!first || !last) return null;
  const asMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = asMinutes(first), end = asMinutes(last);
  if (start <= end) return minute >= start && minute <= end;
  return minute >= start || minute <= end;
}
export function formatTimelineMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
