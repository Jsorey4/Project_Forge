/**
 * @author Saaqib Shaik (calendar & export), Preethi Seereddy (soft deadlines on the calendar) - matches
 *   calendar.html (Month) and calendar-week.html (Week); Day view and the hour grid: Jon Sorey
 * @description Month, Week and Day views of every deadline across the user's projects: task due dates (blue),
 *   soft deadlines (purple) and project deadlines (gold), each chip also carrying an icon so the kind never
 *   depends on color. Month view is a Sunday-first grid with today circled. Week and Day views are an
 *   hour-by-hour grid (6 AM - 10 PM, overlapping items side by side, "Earlier" / "Later" strips for the rest);
 *   clicking a day number in Month or a day header in Week opens that day, and "+n more" opens its Day view
 *   (UI idea ported from Preethi Seereddy's frontend). Read-only: no events are created here. "Connect
 *   Google", "Outlook" and "Export iCal" open the one-way export dialog for the selected project (Google /
 *   Outlook ask for consent first).
 * @traces SE-FR-07, SE-FR-19, UC-07, UC-14
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EventChip } from '../features/calendar/EventChip';
import { KIND_CHIP, KIND_ICON, KIND_LABEL } from '../features/calendar/kinds';
import { TimeGrid } from '../features/calendar/TimeGrid';
import { ExportModal, type CalTarget } from '../features/export/ExportModal';
import { projectController } from '../features/projects/projectController';
import { useProjectScope } from '../features/projects/ProjectScope';
import { useRealtime } from '../services/realtimeClient';
import type { CalendarEvent } from '../shared/types';
import { Select } from '../components/Select';
import { Alert, Icon, PageHeader, Segmented, Spinner } from '../shared/ui';
import { toApiError } from '../shared/useSave';

type View = 'month' | 'week' | 'day';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay());
  return s;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function CalendarPage() {
  const { projects, currentProject } = useProjectScope();
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [projectFilter, setProjectFilter] = useState('');
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<CalTarget | null>(null);

  const range = useMemo(() => {
    if (view === 'day') {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      return { start, end: addDays(start, 1), days: [start] };
    }
    if (view === 'week') {
      const start = startOfWeek(cursor);
      return { start, end: addDays(start, 7), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(first);
    const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const weeks = Math.ceil((lastOfMonth.getDate() + first.getDay()) / 7);
    return { start, end: addDays(start, weeks * 7), days: Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)) };
  }, [view, cursor]);

  const load = useCallback(async () => {
    try {
      setEvents(await projectController.calendarEvents(range.start, range.end, projectFilter || undefined));
      setError(null);
    } catch (err) {
      setError(toApiError(err).detail);
    }
  }, [range, projectFilter]);

  useEffect(() => void load(), [load]);
  useRealtime('task_changed', () => void load());
  useRealtime('soft_deadline_changed', () => void load());

  const byDay = (day: Date) => (events ?? []).filter((e) => sameDay(new Date(e.starts_at), day));
  const shift = (dir: number) => setCursor((c) => (view === 'day' ? addDays(c, dir) : view === 'week' ? addDays(c, dir * 7) : new Date(c.getFullYear(), c.getMonth() + dir, 1)));
  const openDay = (day: Date) => { setCursor(day); setView('day'); };
  const subtitle = view === 'month'
    ? cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : view === 'day'
      ? cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${range.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(range.start, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const exportProject = projects.find((p) => p.id === (projectFilter || currentProject?.id));
  const today = new Date();

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={subtitle}
        actions={
          <Select className="w-auto" value={projectFilter} onChange={setProjectFilter} ariaLabel="Filter by project" options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        }
      />
      <div className="-mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Calendar view" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} />
          {/* One group, so on a narrow screen the three buttons wrap together instead of the next arrow dropping alone. */}
          {/* items-stretch: the icon-only arrows are 4 px shorter than the text button (16 px icon vs 20 px line), so they take its height. */}
          <div className="flex items-stretch gap-2">
            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => shift(-1)} aria-label={`Previous ${view}`}><Icon name="chevron-left" /></button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setCursor(new Date())}>Today</button>
            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => shift(1)} aria-label={`Next ${view}`}><Icon name="chevron-right" /></button>
          </div>
        </div>
        {exportProject ? (
          <div className="flex flex-wrap gap-2.5">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setExportTarget('google')}>Export to Google Calendar</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setExportTarget('outlook')}>Export to Outlook</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setExportTarget('ical')}>Export iCal</button>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        {(Object.keys(KIND_LABEL) as CalendarEvent['kind'][]).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded-sm border-l-[3px] ${KIND_CHIP[k]}`} /><Icon name={KIND_ICON[k]} className="h-3 w-3" /> {KIND_LABEL[k]}</span>
        ))}
      </div>
      {error ? <div className="mt-5"><Alert>{error}</Alert></div> : events === null ? <Spinner /> : view === 'month' ? (
        <div className="card mt-5 overflow-hidden">
          <div className="grid h-10 grid-cols-7 border-b border-line bg-surface-2">
            {WEEKDAYS.map((d) => <div key={d} className="flex items-center justify-center border-r border-line text-xs font-bold uppercase tracking-[0.06em] text-muted last:border-r-0">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 [&>div:nth-child(7n)]:border-r-0">
            {range.days.map((day) => {
              const items = byDay(day);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameDay(day, today);
              return (
                <div key={day.toISOString()} className={`min-h-[118px] min-w-0 border-b border-r border-line p-2 ${inMonth ? '' : 'bg-surface-2'}`}>
                  <button
                    type="button"
                    onClick={() => openDay(day)}
                    aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                    className={`block h-6 w-6 text-center text-[13px] font-semibold leading-6 hover:ring-2 hover:ring-accent/50 ${isToday ? 'rounded-full bg-accent font-bold text-canvas' : `rounded-full ${inMonth ? 'text-body' : 'text-muted'}`}`}
                  >
                    {day.getDate()}
                  </button>
                  {items.slice(0, 3).map((e) => <EventChip key={e.id} event={e} />)}
                  {items.length > 3 ? <button type="button" className="mt-1 text-[11px] font-semibold text-accent" onClick={() => openDay(day)}>+{items.length - 3} more</button> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <TimeGrid days={range.days} events={events} today={today} onDay={view === 'week' ? openDay : undefined} />
      )}
      {exportProject && exportTarget ? (
        <ExportModal open onClose={() => setExportTarget(null)} projectId={exportProject.id} projectName={exportProject.name} role={exportProject.my_role} initialTab="calendar" initialTarget={exportTarget} />
      ) : null}
    </div>
  );
}
