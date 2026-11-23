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
  const wholeMinute = Math.floor(minute);
  return `${String(Math.floor(wholeMinute / 60)).padStart(2, '0')}:${String(wholeMinute % 60).padStart(2, '0')}`;
}

export interface TimelineOverlayEntry {
  line: { stime?: unknown; etime?: unknown };
  overlay: { show: () => void; hide: () => void };
  visible: boolean;
}
/** Keep existing geometry; only update directions whose operating state changed. */
export function updateTimelineVisibility(entries: TimelineOverlayEntry[], minute: number): void {
  for (const entry of entries) {
    // Missing timetable metadata must not make an otherwise valid route vanish.
    const visible = isLineOperating(entry.line, minute) !== false;
    if (visible === entry.visible) continue;
    if (visible) entry.overlay.show(); else entry.overlay.hide();
    entry.visible = visible;
  }
}
