/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`, People page);
 *   reviewed by the area owner, Aashwat Singh
 * @description Dialog opened from a person card on the People page. Header: avatar, name, @username, email.
 *   Two tabs: "Projects" (each project the viewer shares with the person, linked to its page, with the person's
 *   role and a done / total progress bar) and "Tasks" (their assigned tasks grouped under each project, open
 *   tasks first by due date, finished tasks in a collapsed "Completed (n)" group; each task opens its page).
 *   The server returns only projects both people belong to, so nothing else can appear here. Loading, empty and
 *   error (with Retry) states are handled.
 * @traces SE-FR-16, SE-FR-26, SE-FR-30, SE-NFR-11, UC-19
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PersonOverview } from '../../shared/types';
import { formatDate } from '../../shared/format';
import { Alert, Avatar, Badge, EmptyState, Icon, Modal, ModeBadge, ProgressBar, RoleBadge, Segmented, Spinner, StatusBadge } from '../../shared/ui';
import { toApiError } from '../../shared/useSave';
import { memberController } from './memberController';
import { groupTasksByProject, isOverdue, progressPercent } from './model';

type Tab = 'projects' | 'tasks';

interface Props {
  /** The person to show; null keeps the dialog closed. */
  person: { user_id: string; display_name: string; username: string } | null;
  onClose: () => void;
}

export function PersonModal({ person, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('projects');
  const [data, setData] = useState<PersonOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // projects whose "Completed" group is open
  const userId = person?.user_id;

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const result = await memberController.person(userId);
      setData(result);
    } catch (err) {
      setError(toApiError(err).detail);
    }
  }, [userId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setTab('projects');
    setExpanded(new Set());
    if (!userId) return undefined;
    let live = true;
    memberController.person(userId).then((r) => live && setData(r)).catch((err) => live && setError(toApiError(err).detail));
    return () => {
      live = false;
    };
  }, [userId]);

  const groups = data ? groupTasksByProject(data.tasks) : [];
  const toggle = (projectId: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  return (
    <Modal open={!!person} title={person ? `${person.display_name} - projects and tasks` : 'Person'} onClose={onClose} wide>
      {person ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={person.display_name} url={data?.user.avatar_url} size="h-14 w-14" text="text-lg" />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{person.display_name}</p>
              <p className="truncate text-sm text-muted">@{person.username}{data?.user.email ? ` · ${data.user.email}` : ''}</p>
            </div>
          </div>

          {error ? (
            <div className="space-y-3">
              <Alert>{error}</Alert>
              <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}><Icon name="refresh" /> Retry</button>
            </div>
          ) : !data ? (
            <Spinner label="Loading…" />
          ) : (
            <>
              <Segmented<Tab> ariaLabel="Person details" value={tab} onChange={setTab} options={[{ value: 'projects', label: 'Projects' }, { value: 'tasks', label: 'Tasks' }]} />

              {tab === 'projects' ? (
                data.projects.length === 0 ? (
                  <EmptyState icon="folder" title="No shared projects">You and this person are not in a project together.</EmptyState>
                ) : (
                  <ul className="space-y-3" aria-label="Shared projects">
                    {data.projects.map((p) => (
                      <li key={p.id} className="rounded-xl border border-line p-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <Link to={`/projects/${p.id}`} onClick={onClose} className="min-w-0 flex-1 truncate font-semibold text-ink hover:underline">{p.name}</Link>
                          <ModeBadge mode={p.project_type} />
                          <RoleBadge role={p.role} />
                        </div>
                        <div className="mt-3">
                          <div className="mb-1.5 flex items-center justify-between text-[13px] text-body">
                            <span><b className="font-bold text-ink">{p.done_task_count}</b> of {p.task_count} task{p.task_count === 1 ? '' : 's'} done</span>
                            <span>{progressPercent(p.done_task_count, p.task_count)}%</span>
                          </div>
                          <ProgressBar value={progressPercent(p.done_task_count, p.task_count)} color="rgb(var(--c-accent))" label={undefined} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : groups.length === 0 ? (
                <EmptyState icon="tasks" title="No tasks assigned">Nothing is assigned to this person in your shared projects.</EmptyState>
              ) : (
                <div className="space-y-5">
                  {groups.map((g) => (
                    <section key={g.project_id} aria-label={g.project_name}>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
                        <Link to={`/projects/${g.project_id}`} onClick={onClose} className="hover:underline">{g.project_name}</Link>
                        <Badge tone="neutral">{g.open.length} open</Badge>
                      </h3>
                      <ul className="divide-y divide-line rounded-xl border border-line">
                        {g.open.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No open tasks.</li> : null}
                        {g.open.map((t) => (
                          <li key={t.id}>
                            <Link to={`/tasks/${t.id}`} onClick={onClose} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold text-ink">{t.title}</span>
                                <span className={`block text-[13px] ${isOverdue(t) ? 'font-semibold text-danger' : 'text-muted'}`}>
                                  {isOverdue(t) ? 'Overdue · ' : 'Due '}{formatDate(t.due_date, { year: undefined })}
                                </span>
                              </span>
                              <StatusBadge status={t.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {g.completed.length > 0 ? (
                        <div className="mt-2">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            aria-expanded={expanded.has(g.project_id)}
                            aria-controls={`done-${g.project_id}`}
                            onClick={() => toggle(g.project_id)}
                          >
                            <Icon name={expanded.has(g.project_id) ? 'chevron-up' : 'chevron-down'} /> Completed ({g.completed.length})
                          </button>
                          {expanded.has(g.project_id) ? (
                            <ul id={`done-${g.project_id}`} className="mt-1 divide-y divide-line rounded-xl border border-line">
                              {g.completed.map((t) => (
                                <li key={t.id}>
                                  <Link to={`/tasks/${t.id}`} onClick={onClose} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[15px] font-semibold text-muted line-through">{t.title}</span>
                                      <span className="block text-[13px] text-muted">Done {formatDate(t.completed_at ?? t.due_date, { year: undefined })}</span>
                                    </span>
                                    <StatusBadge status={t.status} />
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
