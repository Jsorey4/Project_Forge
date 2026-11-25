/**
 * @author Jon Sorey
 * @description Unit tests for the Select dropdown's keyboard logic.
 * @traces SE-NFR-03
 */
import { describe, expect, it } from 'vitest';
import { extendTypeAhead, findTypeAhead, firstEnabled, lastEnabled, stepEnabled, type SelectOption } from './selectModel';

const opts: SelectOption[] = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana', disabled: true },
  { value: 'c', label: 'Cherry' },
  { value: 'd', label: 'Avocado' },
];

describe('SE-NFR-03 Select keyboard model', () => {
  it('finds the first and last enabled option', () => {
    expect(firstEnabled(opts)).toBe(0);
    expect(lastEnabled(opts)).toBe(3);
    expect(firstEnabled([{ value: 'x', label: 'X', disabled: true }])).toBe(-1);
    expect(lastEnabled([])).toBe(-1);
  });
  it('steps over disabled options and wraps at both ends', () => {
    expect(stepEnabled(opts, 0, 1)).toBe(2);
    expect(stepEnabled(opts, 3, 1)).toBe(0);
    expect(stepEnabled(opts, 0, -1)).toBe(3);
    expect(stepEnabled(opts, 2, -1)).toBe(0);
  });
  it('starts from the ends when nothing is active', () => {
    expect(stepEnabled(opts, -1, 1)).toBe(0);
    expect(stepEnabled(opts, -1, -1)).toBe(3);
    expect(stepEnabled([], -1, 1)).toBe(-1);
  });
  it('type-ahead extends the buffer and resets after a pause', () => {
    const a = extendTypeAhead({ buffer: '', at: 0 }, 'A', 100);
    expect(a).toEqual({ buffer: 'a', at: 100 });
    expect(extendTypeAhead(a, 'v', 300).buffer).toBe('av');
    expect(extendTypeAhead(a, 'c', 5000).buffer).toBe('c');
  });
  it('type-ahead finds a prefix match, skips disabled options, and cycles on a repeated letter', () => {
    expect(findTypeAhead(opts, 'av', 0)).toBe(3);
    expect(findTypeAhead(opts, 'b', 0)).toBe(-1);
    expect(findTypeAhead(opts, 'a', 0)).toBe(3);
    expect(findTypeAhead(opts, 'a', 3)).toBe(0);
    expect(findTypeAhead(opts, 'zz', 0)).toBe(-1);
    expect(findTypeAhead(opts, '', 0)).toBe(-1);
  });
});
