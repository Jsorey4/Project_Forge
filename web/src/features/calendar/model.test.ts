/**
 * @author Jon Sorey
 * @description Unit tests for the calendar time-grid layout: hour positioning, the Earlier / Later strips and
 *   side-by-side placement of overlapping items.
 * @traces SE-FR-07, SE-FR-19, UC-14
 */
import { describe, expect, it } from 'vitest';
import { HOUR_PX, MIN_CHIP_PX, hourLabel, hourOfDay, layoutTimed, splitByGrid } from './model';

/** A local-time ISO string, so the tests do not depend on the machine's time zone. */
const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m).toISOString();
const ev = (id: string, h: number, m = 0) => ({ id, starts_at: at(h, m) });

describe('UC-14 calendar time grid', () => {
  it('reads the local time of day as fractional hours', () => {
    expect(hourOfDay(at(9, 30))).toBe(9.5);
    expect(hourOfDay(at(0, 0))).toBe(0);
  });
  it('sends items before 6:00 to Earlier and from 22:00 to Later, and keeps the rest on the grid', () => {
    const split = splitByGrid([ev('dawn', 5, 59), ev('six', 6), ev('late-grid', 21, 59), ev('ten-pm', 22), ev('night', 23, 30)]);
    expect(split.earlier.map((e) => e.id)).toEqual(['dawn']);
    expect(split.timed.map((e) => e.id)).toEqual(['six', 'late-grid']);
    expect(split.later.map((e) => e.id)).toEqual(['ten-pm', 'night']);
  });
  it('places an item by its time: top from the 6:00 start, height at least the minimum chip height', () => {
    const [placed] = layoutTimed([ev('a', 9, 30)]);
    expect(placed.top).toBe(3.5 * HOUR_PX);
    expect(placed.height).toBe(MIN_CHIP_PX);
    expect(placed.col).toBe(0);
    expect(placed.cols).toBe(1);
  });
  it('clamps an item near the end of the grid so it never runs past 22:00', () => {
    const [placed] = layoutTimed([ev('late', 21, 50)]);
    expect(placed.top + placed.height).toBe(16 * HOUR_PX);
  });
  it('puts overlapping items side by side and lets a later item reuse a free column', () => {
    // 09:00 and 09:20 overlap (each shown ~52 min); 09:55 starts after the first ends but before the second does.
    const placed = layoutTimed([ev('a', 9), ev('b', 9, 20), ev('c', 9, 55)]);
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect([by.a.col, by.b.col, by.c.col]).toEqual([0, 1, 0]);
    expect([by.a.cols, by.b.cols, by.c.cols]).toEqual([2, 2, 2]);
  });
  it('keeps far-apart items in their own full-width group', () => {
    const placed = layoutTimed([ev('a', 9), ev('b', 11), ev('c', 11, 10)]);
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect([by.a.col, by.a.cols]).toEqual([0, 1]);
    expect([by.b.cols, by.c.cols]).toEqual([2, 2]);
  });
  it('orders the result by time even when the input is unordered', () => {
    expect(layoutTimed([ev('late', 15), ev('early', 8)]).map((p) => p.event.id)).toEqual(['early', 'late']);
  });
  it('labels hours as 6 AM, 12 PM and 9 PM', () => {
    expect([6, 12, 13, 21].map(hourLabel)).toEqual(['6 AM', '12 PM', '1 PM', '9 PM']);
  });
});
