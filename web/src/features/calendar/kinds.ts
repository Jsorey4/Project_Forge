/**
 * @author Saaqib Shaik (calendar), Preethi Seereddy (soft deadlines on the calendar); moved here from CalendarPage
 * @description What each calendar item kind looks like (icon, label, mockup chip colors) and where it links to.
 *   The kind is always shown with an icon as well as a color, so it never depends on color alone.
 * @traces SE-FR-07, SE-FR-15, SE-FR-19, UC-14
 */
import type { CalendarEvent } from '../../shared/types';

export const KIND_ICON: Record<CalendarEvent['kind'], string> = { project_deadline: 'flag', task_due: 'check', soft_deadline: 'target' };
export const KIND_LABEL: Record<CalendarEvent['kind'], string> = { project_deadline: 'Project deadline', task_due: 'Task due', soft_deadline: 'Soft deadline' };
/** Mockup chips: .chip-i (blue), .chip-p (purple), .chip-g (gold). */
export const KIND_CHIP: Record<CalendarEvent['kind'], string> = {
  task_due: 'bg-brand/15 text-brand border-brand',
  soft_deadline: 'bg-accent-deep text-accent-tint border-accent',
  project_deadline: 'bg-warn/15 text-warn border-warn',
};

export function chipLink(event: CalendarEvent): string {
  return event.task_id ? `/tasks/${event.task_id}` : `/projects/${event.project_id}`;
}
