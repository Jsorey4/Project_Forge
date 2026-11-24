/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`, People page);
 *   reviewed by the area owner, Aashwat Singh
 * @description Pure rules for the People dialog: tasks grouped under their project, open tasks first by due
 *   date and finished tasks (newest first) kept apart so the dialog can collapse them, plus the progress
 *   percentage and the overdue check. No network calls, so it is unit-tested directly.
 * @traces SE-FR-26, SE-FR-30, UC-19
 */
import type { PersonTask } from '../../shared/types';

export interface ProjectTaskGroup {
  project_id: string;
  project_name: string;
  open: PersonTask[];
  completed: PersonTask[];
}

const byDue = (a: PersonTask, b: PersonTask) => a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title);
const byDoneNewestFirst = (a: PersonTask, b: PersonTask) => (b.completed_at ?? b.due_date).localeCompare(a.completed_at ?? a.due_date) || a.title.localeCompare(b.title);

/** Groups by project (A to Z); inside a project, open tasks come first by due date, finished tasks separately. */
export function groupTasksByProject(tasks: PersonTask[]): ProjectTaskGroup[] {
  const groups = new Map<string, ProjectTaskGroup>();
  for (const task of tasks) {
    const group = groups.get(task.project_id) ?? { project_id: task.project_id, project_name: task.project_name, open: [], completed: [] };
    (task.status === 'done' ? group.completed : group.open).push(task);
    groups.set(task.project_id, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, open: [...g.open].sort(byDue), completed: [...g.completed].sort(byDoneNewestFirst) }))
    .sort((a, b) => a.project_name.localeCompare(b.project_name));
}

/** "x of y done" as a whole percentage; 0 when nothing is assigned. */
export function progressPercent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** An unfinished task whose final due date has passed. */
export function isOverdue(task: Pick<PersonTask, 'status' | 'due_date'>, now: Date = new Date()): boolean {
  return task.status !== 'done' && new Date(task.due_date).getTime() < now.getTime();
}
