/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`)
 * @description Pure keyboard logic for the shared Select dropdown: stepping through enabled options with
 *   wrap-around, Home/End, and type-ahead matching. No React or DOM, so it is unit-tested directly.
 * @traces SE-NFR-03, SE-NFR-05
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Index of the first enabled option, or -1 when none is enabled. */
export function firstEnabled(options: SelectOption[]): number {
  return options.findIndex((o) => !o.disabled);
}

/** Index of the last enabled option, or -1 when none is enabled. */
export function lastEnabled(options: SelectOption[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) if (!options[i].disabled) return i;
  return -1;
}

/** Next (dir = 1) or previous (dir = -1) enabled option, wrapping at the ends. `from` may be -1 (nothing active). */
export function stepEnabled(options: SelectOption[], from: number, dir: 1 | -1): number {
  const n = options.length;
  if (n === 0) return -1;
  let i = from;
  for (let step = 0; step < n; step += 1) {
    i = from < 0 && step === 0 ? (dir === 1 ? 0 : n - 1) : (((i + dir) % n) + n) % n;
    if (!options[i].disabled) return i;
  }
  return -1;
}

export const TYPE_AHEAD_MS = 700;

export interface TypeAhead {
  buffer: string;
  at: number;
}

/** Appends a printable key to the type-ahead buffer, starting over when the pause was longer than the timeout. */
export function extendTypeAhead(prev: TypeAhead, key: string, now: number, timeoutMs = TYPE_AHEAD_MS): TypeAhead {
  const buffer = now - prev.at > timeoutMs ? key : prev.buffer + key;
  return { buffer: buffer.toLowerCase(), at: now };
}

/**
 * Index of the enabled option whose label starts with `buffer`. A repeated single letter ("aaa") cycles through
 * the options that start with that letter, starting after the active one; a longer word matches from the active one.
 */
export function findTypeAhead(options: SelectOption[], buffer: string, active: number): number {
  if (!buffer) return -1;
  const cycling = buffer.split('').every((c) => c === buffer[0]);
  const needle = cycling ? buffer[0] : buffer;
  const start = cycling ? active + 1 : Math.max(active, 0);
  for (let step = 0; step < options.length; step += 1) {
    const i = (start + step) % options.length;
    if (!options[i].disabled && options[i].label.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}
