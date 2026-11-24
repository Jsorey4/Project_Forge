/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`, Calendar page);
 *   reviewed by the area owner, Saaqib Shaik
 * @description The hour-by-hour grid behind the Week (7 columns) and Day (1 column) views: hour labels from
 *   6 AM to 9 PM, each item placed by its time, overlapping items side by side, and "Earlier" / "Later" strips
 *   for items outside 6:00-22:00. A day header opens that day in Day view. Read-only: it links to the task or
 *   project and never creates events. Wide grids scroll inside their own card instead of the page.
 * @traces SE-FR-07, SE-FR-19, UC-14
 */
import { Link } from 'react-router-dom';
import type { CalendarEvent } from '../../shared/types';
import { formatTime } from '../../shared/format';
import { Icon } from '../../shared/ui';
import { EventChip, eventTooltip } from './EventChip';
import { KIND_CHIP, KIND_ICON, KIND_LABEL, chipLink } from './kinds';
import { GRID_END_HOUR, GRID_START_HOUR, HOUR_PX, hourLabel, layoutTimed, splitByGrid } from './model';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
const GUTTER = '3.5rem';

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface Props {
  days: Date[];
  events: CalendarEvent[];
  today: Date;
  /** Called with a day when its header is clicked (Week view); omit in Day view. */
  onDay?: (day: Date) => void;
}

export function TimeGrid({ days, events, today, onDay }: Props) {
  const columns = days.map((day) => {
    const own = events.filter((e) => sameDay(new Date(e.starts_at), day));
    const { earlier, timed, later } = splitByGrid(own);
    return { day, earlier, later, placed: layoutTimed(timed) };
  });
  const hasEarlier = columns.some((c) => c.earlier.length > 0);
  const hasLater = columns.some((c) => c.later.length > 0);
  const template = { gridTemplateColumns: `${GUTTER} repeat(${days.length}, minmax(0, 1fr))` };
  const single = days.length === 1;
  // In the seven-column Week view two side-by-side chips are only ~35 px wide, so they drop the icon (the kind
  // stays in the color, the tooltip and the screen-reader text); the one-column Day view always shows it.
  const cramped = (cols: number) => cols > 1 && !single;

  const strip = (label: string, pick: (c: (typeof columns)[number]) => CalendarEvent[], position: 'top' | 'bottom') => (
    <div className={`grid border-line bg-surface-2/60 ${position === 'top' ? 'border-b' : 'border-t'}`} style={template}>
      <div className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
      {columns.map((c) => (
        <div key={c.day.toISOString()} className="min-w-0 border-l border-line px-1.5 pb-1.5">
          {pick(c).map((e) => <EventChip key={e.id} event={e} />)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="card mt-5 overflow-x-auto">
      <div className={single ? '' : 'min-w-[760px]'} aria-label={single ? 'Day schedule' : 'Week schedule'}>
        <div className="grid h-16 border-b border-line bg-surface-2" style={template}>
          <div />
          {columns.map(({ day }) => {
            const isToday = sameDay(day, today);
            const label = (
              <>
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-muted">{WEEKDAYS[day.getDay()]}</span>
                <span className={`h-7 w-7 text-center text-[17px] font-bold leading-7 ${isToday ? 'rounded-full bg-accent text-canvas' : 'text-ink'}`}>{day.getDate()}</span>
              </>
            );
            return onDay ? (
              <button
                key={day.toISOString()}
                type="button"
               
                onClick={() => onDay(day)}
                aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                className="flex flex-col items-center justify-center gap-0.5 border-l border-line hover:bg-surface"
              >
                {label}
              </button>
            ) : (
              <div key={day.toISOString()} className="flex flex-col items-center justify-center gap-0.5 border-l border-line">{label}</div>
            );
          })}
        </div>
        {hasEarlier ? strip('Earlier', (c) => c.earlier, 'top') : null}
        <div className="grid" style={template}>
          <div aria-hidden="true">
            {HOURS.map((h) => (
              <div key={h} className="pr-2 text-right text-[11px] font-medium text-muted" style={{ height: HOUR_PX }}>
                <span className="relative top-0.5">{hourLabel(h)}</span>
              </div>
            ))}
          </div>
          {columns.map(({ day, placed }) => (
            <div key={day.toISOString()} role="group" aria-label={day.toDateString()} className="relative min-w-0 border-l border-line" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((h) => <div key={h} className={h === GRID_START_HOUR ? '' : 'border-t border-line'} style={{ height: HOUR_PX }} />)}
              {placed.map(({ event, col, cols, top, height }) => (
                <Link
                  key={event.id}
                  to={chipLink(event)}
                  title={eventTooltip(event)}
                  style={{ top, height, left: `calc(3px + (100% - 6px) * ${col / cols})`, width: `calc((100% - 6px) / ${cols} - 2px)` }}
                  className={`absolute z-10 flex min-w-0 flex-col overflow-hidden rounded-lg border-l-[3px] py-1 ${cramped(cols) ? 'px-1' : 'px-2'} ${KIND_CHIP[event.kind]} ${event.is_completed ? 'opacity-50' : ''}`}
                >
                  <span className="flex items-start gap-1 text-[12px] font-bold leading-4">
                    {cramped(cols) ? <span className="sr-only">{KIND_LABEL[event.kind]}: </span> : <Icon name={KIND_ICON[event.kind]} className="mt-[3px] h-3 w-3" />}
                    <span className={`min-w-0 [overflow-wrap:anywhere] ${event.is_completed ? 'line-through' : ''} line-clamp-2`}>{event.title}</span>
                  </span>
                  <span className="mt-auto truncate text-[11px] leading-4">{formatTime(event.starts_at)}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
        {hasLater ? strip('Later', (c) => c.later, 'bottom') : null}
      </div>
    </div>
  );
}
