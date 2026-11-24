/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`, Calendar page);
 *   reviewed by the area owner, Saaqib Shaik
 * @description Pure layout rules for the Week and Day time grid: which items fall inside the 6:00-22:00 grid
 *   and which go to the "Earlier" / "Later" strips, where an item sits (top and height in pixels), and how
 *   items that overlap in time are placed side by side. Calendar items have a start but no end, so each is
 *   treated as a block of EVENT_MINUTES (30 min), shown at least MIN_CHIP_PX tall so its icon, two-line title
 *   and time stay readable; overlap is decided from that shown height, so two chips never print on top of each
 *   other. No DOM or network, so it is unit-tested directly.
 * @traces SE-FR-07, SE-FR-19, UC-14
 */
export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 22;
export const HOUR_PX = 64;
export const EVENT_MINUTES = 30;
export const MIN_CHIP_PX = 56; // 4 px padding + two 16 px title lines + a 16 px time line + 4 px padding

export interface GridOptions {
  startHour?: number;
  endHour?: number;
  hourPx?: number;
}

/** Local time of day as fractional hours (09:30 -> 9.5). */
export function hourOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

/** Items before 6:00 go to "Earlier", items from 22:00 on go to "Later", the rest are placed on the grid. */
export function splitByGrid<T extends { starts_at: string }>(events: T[], { startHour = GRID_START_HOUR, endHour = GRID_END_HOUR }: GridOptions = {}): { earlier: T[]; timed: T[]; later: T[] } {
  const result: { earlier: T[]; timed: T[]; later: T[] } = { earlier: [], timed: [], later: [] };
  for (const event of events) {
    const hour = hourOfDay(event.starts_at);
    (hour < startHour ? result.earlier : hour >= endHour ? result.later : result.timed).push(event);
  }
  return result;
}

export interface Placed<T> {
  event: T;
  /** Column among the items it overlaps (0 = leftmost) and how many columns that group has. */
  col: number;
  cols: number;
  top: number;
  height: number;
}

/** Places each timed item and puts overlapping items side by side (greedy first free column per overlap group). */
export function layoutTimed<T extends { starts_at: string }>(events: T[], { startHour = GRID_START_HOUR, endHour = GRID_END_HOUR, hourPx = HOUR_PX }: GridOptions = {}): Placed<T>[] {
  const span = Math.max(EVENT_MINUTES / 60, MIN_CHIP_PX / hourPx);
  const items = events
    .map((event) => {
      const start = Math.min(endHour, Math.max(startHour, hourOfDay(event.starts_at)));
      return { event, start, end: Math.min(endHour, start + span) };
    })
    .sort((a, b) => a.start - b.start);

  const out: Placed<T>[] = [];
  let group: { event: T; start: number; end: number; col: number }[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) out.push({ event: g.event, col: g.col, cols, top: (g.start - startHour) * hourPx, height: (g.end - g.start) * hourPx });
    group = [];
  };
  for (const item of items) {
    if (group.length && item.start >= groupEnd) flush();
    const taken = new Set(group.filter((g) => g.end > item.start).map((g) => g.col));
    let col = 0;
    while (taken.has(col)) col += 1;
    group.push({ ...item, col });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) flush();
  return out;
}

/** "6 AM", "12 PM", "9 PM" for the hour labels. */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}
