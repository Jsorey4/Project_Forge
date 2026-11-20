/**
 * @author Aashwat Singh - matches people.html
 * @description The project's team directory as person cards: tinted initials avatar, name, Owner / Manager /
 *   Member role badge, the project and their task count, and an "x of y done" progress bar. Owners and
 *   managers can invite people (a pending invitation they can cancel until it is accepted), change roles
 *   (never leaving the project without an owner) and
 *   remove members while reassigning their open tasks; anyone can leave a project. Changes apply on the
 *   next request because the server re-checks membership every time.
 * @traces SE-FR-30, SE-NFR-09, SE-NFR-11, UC-19, UC-20
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { InviteMemberModal } from '../features/members/InviteMemberModal';
import { ReassignTasksModal } from '../features/members/ReassignTasksModal';
import { RoleSelect } from '../features/members/RoleSelect';
import { memberController } from '../features/members/memberController';
import { ProjectPicker, useProjectScope } from '../features/projects/ProjectScope';
import { useRealtime } from '../services/realtimeClient';
import { isManager } from '../shared/permissions';
import type { Invitation, Member, Role } from '../shared/types';
import { Alert, Avatar, Badge, EmptyState, Icon, PageHeader, ProgressBar, RoleBadge, Spinner } from '../shared/ui';
import { toApiError } from '../shared/useSave';

export function PeoplePage() {
  const { user } = useAuth();
  const { currentProject, loading, refresh } = useProjectScope();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pending, setPending] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!currentProject) return;
    try {
      setMembers(await memberController.list(currentProject.id));
      // Only owners and managers may see the project's open invitations.
      setPending(isManager(currentProject.my_role) ? await memberController.invitations(currentProject.id) : []);
    } catch (err) {
      setError(toApiError(err).detail);
    }
  }, [currentProject]);

  useEffect(() => { setMembers(null); void load(); }, [currentProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime('membership_changed', (d: { project_id: string }) => d.project_id === currentProject?.id && void load());
  useRealtime('invitation', (d: { project_id: string }) => d.project_id === currentProject?.id && void load());

  if (loading) return <Spinner />;
  if (!currentProject) return <EmptyState title="No project selected" icon="users" />;
  const callerRole = currentProject.my_role;
  const manager = isManager(callerRole);

  const changeRole = async (m: Member, role: Role) => {
    setError(null);
    setNotice(null);
    try {
      await memberController.changeRole(currentProject.id, m.user_id, role);
      setNotice(`${m.display_name} is now ${role === 'owner' ? 'an' : 'a'} ${role}.`);
      await load();
      if (m.user_id === user?.id) await refresh();
    } catch (err) {
      setError(toApiError(err).detail);
      await load(); // put the select back to the saved role
    }
  };

  const cancelInvitation = async (inv: Invitation) => {
    setError(null);
    try {
      await memberController.cancelInvitation(currentProject.id, inv.id);
      setNotice(`The invitation to ${inv.invitee.display_name} was cancelled.`);
      await load();
    } catch (err) {
      setError(toApiError(err).detail);
      await load();
    }
  };

  const leave = async () => {
    if (!user || !window.confirm(`Leave "${currentProject.name}"? Your open tasks will become unassigned.`)) return;
    try {
      await memberController.remove(currentProject.id, user.id);
      await refresh();
      navigate('/projects');
    } catch (err) {
      setError(toApiError(err).detail);
    }
  };

  const visible = (members ?? []).filter((m) => !search.trim() || `${m.display_name} ${m.username} ${m.email}`.toLowerCase().includes(search.toLowerCase()));
  const counts = { owner: 0, manager: 0, member: 0 };
  (members ?? []).forEach((m) => (counts[m.role] += 1));

  return (
    <div>
      <PageHeader
        title="People"
        subtitle={<><b>{members?.length ?? 0}</b> in {currentProject.name} · {counts.owner} owner{counts.owner === 1 ? '' : 's'}, {counts.manager} manager{counts.manager === 1 ? '' : 's'}, {counts.member} member{counts.member === 1 ? '' : 's'}</>}
        actions={
          <>
            <ProjectPicker />
            {manager ? <button type="button" className="btn-primary" onClick={() => setInviting(true)}><Icon name="plus" /> Invite member</button> : null}
          </>
        }
      />
      <div className="mb-6 space-y-3 empty:hidden">
        {error ? <Alert onClose={() => setError(null)}>{error}</Alert> : null}
        {notice ? <Alert tone="ok" onClose={() => setNotice(null)}>{notice}</Alert> : null}
        {!manager ? <Alert tone="info">Only owners and managers can add people, change roles or remove members.</Alert> : null}
      </div>
      {pending.length > 0 ? (
        <section className="card mb-6 p-5" aria-label="Pending invitations">
          <h2 className="text-base font-bold text-ink">Pending invitations ({pending.length})</h2>
          <p className="mt-0.5 text-[13px] text-muted">These people join only after they accept.</p>
          <ul className="mt-3 divide-y divide-line">
            {pending.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 py-2.5" data-invitation-id={inv.id}>
                <Avatar name={inv.invitee.display_name || inv.invitee.username} url={inv.invitee.avatar_url} size="h-9 w-9" text="text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{inv.invitee.display_name} <span className="font-normal text-muted">@{inv.invitee.username}</span></p>
                  <p className="text-xs text-muted">Invited as <RoleBadge role={inv.role} /> by {inv.invited_by?.display_name ?? 'someone who left'}</p>
                </div>
                <Badge tone="warn" icon="clock">Pending</Badge>
                <button type="button" className="btn-ghost btn-sm hover:text-danger" onClick={() => void cancelInvitation(inv)} aria-label={`Cancel invitation to ${inv.invitee.display_name}`}>
                  <Icon name="x" className="h-3.5 w-3.5" /> Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {(members?.length ?? 0) > 8 ? (
        <div className="relative mb-6 max-w-sm">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-10" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
        </div>
      ) : null}
      {members === null ? <Spinner /> : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((m) => {
            const isSelf = m.user_id === user?.id;
            const canRemove = !isSelf && manager && (m.role !== 'owner' || callerRole === 'owner');
            const pct = m.task_count ? (m.done_task_count / m.task_count) * 100 : 0;
            return (
              <article key={m.user_id} className="card flex flex-col p-6" aria-label={m.display_name}>
                <div className="flex items-center gap-3.5">
                  <Avatar name={m.display_name} url={m.avatar_url} size="h-14 w-14" text="text-lg" />
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-bold leading-6 text-ink">{m.display_name}{isSelf ? <span className="ml-1 text-xs font-medium text-muted">(you)</span> : null}</p>
                    <p className="truncate text-[13px] text-muted">@{m.username}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  {manager ? <RoleSelect value={m.role} callerRole={callerRole} onChange={(r) => void changeRole(m, r)} label={`Role for ${m.display_name}`} /> : <RoleBadge role={m.role} />}
                </div>
                <div className="mt-5">
                  <p className="text-sm font-semibold text-ink">{currentProject.name}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{m.task_count} task{m.task_count === 1 ? '' : 's'} · {m.open_task_count} open</p>
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-[13px] text-body">
                    <span><b className="font-bold text-ink">{m.done_task_count}</b> of {m.task_count} done</span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                  <ProgressBar value={pct} color="rgb(var(--c-accent))" />
                </div>
                <div className="mt-auto flex justify-end gap-1 pt-4">
                  {canRemove ? <button type="button" className="btn-ghost btn-sm hover:text-danger" onClick={() => setRemoving(m)}><Icon name="trash" className="h-3.5 w-3.5" /> Remove</button> : null}
                  {isSelf ? <button type="button" className="btn-ghost btn-sm" onClick={() => void leave()}><Icon name="logout" className="h-3.5 w-3.5" /> Leave</button> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <InviteMemberModal open={inviting} projectId={currentProject.id} callerRole={callerRole} onClose={() => setInviting(false)} onInvited={(inv) => { setInviting(false); setNotice(`Invitation sent to ${inv.invitee.display_name}. They join as ${inv.role} once they accept.`); void load(); }} />
      <ReassignTasksModal open={!!removing} projectId={currentProject.id} member={removing} members={members ?? []} onClose={() => setRemoving(null)} onRemoved={(msg) => { setRemoving(null); setNotice(msg); void load(); }} />
    </div>
  );
}
