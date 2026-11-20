/**
 * @author Saaqib Shaik
 * @description Unit tests for the project form rules: members typed as usernames or emails, a required name,
 *   a future deadline, and card ordering.
 * @traces SE-FR-16, SE-FR-17, UC-12, UC-13
 */
import { describe, expect, it } from 'vitest';
import type { Project } from '../../shared/types';
import { deadlineCountdown, parseUsernames, sortByCardOrder, validateProjectForm } from './model';

describe('UC-12 create-project rules', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  it('requires a name, a type and a future deadline', () => {
    expect(validateProjectForm({ name: '  ', deadline: '', project_type: '' }, now)).toEqual({
      name: 'Project name is required',
      project_type: 'Choose a project type',
      deadline: 'Choose a deadline',
    });
    expect(validateProjectForm({ name: 'X', deadline: '2026-11-20T11:59:00Z', project_type: 'work' }, now).deadline).toBe('Deadline must be in the future');
    expect(validateProjectForm({ name: 'X', deadline: '2026-11-20T12:00:00Z', project_type: 'work' }, now).deadline).toBe('Deadline must be in the future');
    expect(validateProjectForm({ name: 'X', deadline: '2026-11-21T12:00:00Z', project_type: 'school' }, now)).toEqual({});
  });

  it('accepts members as usernames or emails, separated by commas, spaces or semicolons, without duplicates', () => {
    expect(parseUsernames('tyler, @staff  Preethi@Example.com;tyler ,TYLER')).toEqual(['tyler', 'staff', 'Preethi@Example.com']);
    expect(parseUsernames('   ')).toEqual([]);
    expect(parseUsernames('a@b.co a@B.CO')).toEqual(['a@b.co']);
  });

  it('UC-13: cards are ordered by the saved order, then by creation time', () => {
    const p = (id: string, card_order: number, created_at: string) => ({ id, card_order, created_at }) as Project;
    expect(sortByCardOrder([p('c', 1, '2026-01-03'), p('a', 0, '2026-01-02'), p('b', 0, '2026-01-01')]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('words the deadline countdown', () => {
    const base = new Date('2026-11-20T12:00:00Z');
    expect(deadlineCountdown('2026-11-27T12:00:00Z', base)).toMatchObject({ text: '7 days left', overdue: false, soon: true });
    expect(deadlineCountdown('2026-11-18T12:00:00Z', base)).toMatchObject({ text: '2 days overdue', overdue: true });
    expect(deadlineCountdown('2026-11-20T12:30:00Z', base)).toMatchObject({ text: 'Due today', soon: true });
  });
});
