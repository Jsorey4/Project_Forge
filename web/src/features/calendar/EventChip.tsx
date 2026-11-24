/**
 * @author Saaqib Shaik (calendar); moved here from CalendarPage
 * @description The one-line chip for a calendar item (icon + title) used in Month cells and in the Earlier /
 *   Later strips of the time grid. Links to the task (or the project for a project deadline); the tooltip keeps
 *   kind, title, project and time.
 * @traces SE-FR-07, SE-FR-19, UC-14
 */
import { Link } from 'react-router-dom';
import type { CalendarEvent } from '../../shared/types';
import { formatTime } from '../../shared/format';
import { Icon } from '../../shared/ui';
import { KIND_CHIP, KIND_ICON, KIND_LABEL, chipLink } from './kinds';

export function eventTooltip(event: CalendarEvent): string {
  return `${KIND_LABEL[event.kind]} · ${event.title} · ${event.project_name} · ${formatTime(event.starts_at)}`;
}

export function EventChip({ event }: { event: CalendarEvent }) {
  return (
    <Link to={chipLink(event)} title={eventTooltip(event)}
      className={`mt-1.5 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-md border-l-[3px] px-2 py-[3px] text-xs font-semibold leading-4 ${KIND_CHIP[event.kind]} ${event.is_completed ? 'opacity-50 line-through' : ''}`}>
      <Icon name={KIND_ICON[event.kind]} className="h-3 w-3" />
      <span className="truncate">{event.title}</span>
    </Link>
  );
}
