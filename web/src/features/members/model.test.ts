/**
 * @author Jon Sorey
 * @description Unit tests for the People dialog's grouping, progress and overdue rules.
 * @traces SE-FR-26, UC-19
 */
import { describe, expect, it } from 'vitest';
import type { PersonTask } from '../../shared/types';
import { groupTasksByProject, isOverdue, progressPercent } from './model';

const task = (id: string, project: string, status: PersonTask['status'], due: string, completed: string | null = null): PersonTask => ({
  id, project_id: project.toLowerCase(), project_name: project, title: id, status, priority: 'medium', due_date: due, completed_at: completed,
});

describe('UC-19 person overview grouping', () => {
  it('groups by project name and keeps open tasks first by due date', () => {
    const groups = groupTasksByProject([
      task('late', 'Zeta', 'todo', '2026-12-20T10:00:00Z'),
      task('soon', 'Zeta', 'in_progress', '2026-12-01T10:00:00Z'),
      task('other', 'Alpha', 'review', '2026-12-05T10:00:00Z'),
    ]);
    expect(groups.map((g) => g.project_name)).toEqual(['Alpha', 'Zeta']);
    expect(groups[1].open.map((t) => t.id)).toEqual(['soon', 'late']);
  });
  it('separates finished tasks, newest first, so the dialog can collapse them', () => {
    const [group] = groupTasksByProject([
      task('old', 'P', 'done', '2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z'),
      task('new', 'P', 'done', '2026-11-03T10:00:00Z', '2026-11-20T10:00:00Z'),
      task('open', 'P', 'todo', '2026-12-01T10:00:00Z'),
    ]);
    expect(group.open.map((t) => t.id)).toEqual(['open']);
    expect(group.completed.map((t) => t.id)).toEqual(['new', 'old']);
  });
  it('returns no groups for no tasks and does not change its input', () => {
    expect(groupTasksByProject([])).toEqual([]);
    const input = [task('b', 'P', 'todo', '2026-12-02T10:00:00Z'), task('a', 'P', 'todo', '2026-12-01T10:00:00Z')];
    groupTasksByProject(input);
    expect(input.map((t) => t.id)).toEqual(['b', 'a']);
  });
  it('computes progress and overdue', () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(0, 0)).toBe(0);
    const now = new Date('2026-12-10T00:00:00Z');
    expect(isOverdue({ status: 'todo', due_date: '2026-12-01T00:00:00Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'done', due_date: '2026-12-01T00:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'todo', due_date: '2026-12-20T00:00:00Z' }, now)).toBe(false);
  });
});
