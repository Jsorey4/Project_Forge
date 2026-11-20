/**
 * @author Aashwat Singh
 * @description Unit tests for the feature-list rules on the board: valid and unique names, and the task count
 *   per list (including tasks without a list).
 * @traces SE-FR-27, UC-18
 */
import { describe, expect, it } from 'vitest';
import { listCounts, validateListName } from './ListManager';

describe('UC-18 feature lists', () => {
  const lists = [{ id: 'a', name: 'Planning' }, { id: 'b', name: 'Build' }];
  it('requires a name that is not too long and not already used (case-insensitive)', () => {
    expect(validateListName('', lists)).toBe('Give the list a name');
    expect(validateListName('   ', lists)).toBe('Give the list a name');
    expect(validateListName('x'.repeat(81), lists)).toBe('List names are limited to 80 characters');
    expect(validateListName('  build ', lists)).toBe('There is already a list with that name');
    expect(validateListName('Launch', lists)).toBeUndefined();
    expect(validateListName('x'.repeat(80), lists)).toBeUndefined();
  });
  it('renaming a list to its own name (or a new case) is allowed', () => {
    expect(validateListName('PLANNING', lists, 'a')).toBeUndefined();
    expect(validateListName('Build', lists, 'a')).toBe('There is already a list with that name');
  });
  it('counts tasks per list, with a separate count for no list', () => {
    const counts = listCounts([{ list_id: 'a' }, { list_id: 'a' }, { list_id: 'b' }, { list_id: null }]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get(null)).toBe(1);
    expect(counts.get('zzz')).toBeUndefined();
  });
});
