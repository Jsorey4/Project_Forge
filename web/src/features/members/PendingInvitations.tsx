/**
 * @author Aashwat Singh
 * @description Invitations waiting for the signed-in person (UC-19). Each one says who invited them, to which
 *   project and in which role, with Accept and Decline buttons. Nothing about a project changes until they
 *   press Accept; the list updates live when a new invitation arrives and shows the server's message if an
 *   invitation can no longer be used (already answered, or its sender lost the right to send it).
 * @traces SE-FR-30, SE-NFR-11, SE-NFR-12, UC-19
 */
import { useCallback, useEffect, useState } from 'react';
import { useRealtime } from '../../services/realtimeClient';
import type { Invitation } from '../../shared/types';
import { Alert, Avatar, Icon, RoleBadge } from '../../shared/ui';
import { toApiError } from '../../shared/useSave';
import { memberController } from './memberController';

export function PendingInvitations({ onAccepted }: { onAccepted: (invitation: Invitation) => void | Promise<void> }) {
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await memberController.mine());
    } catch (err) {
      setError(toApiError(err).detail);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useRealtime('invitation', () => void load());
  useRealtime('notification', () => void load());

  const answer = async (invitation: Invitation, accept: boolean) => {
    setBusy(invitation.id);
    setError(null);
    setNotice(null);
    try {
      if (accept) {
        await memberController.accept(invitation.id);
        setNotice(`You joined ${invitation.project_name} as ${invitation.role}.`);
        await onAccepted(invitation);
      } else {
        await memberController.decline(invitation.id);
        setNotice(`You declined the invitation to ${invitation.project_name}.`);
      }
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (items === null || (items.length === 0 && !error && !notice)) return null;
  return (
    <section className="mb-6 space-y-3" aria-label="Project invitations">
      {error ? <Alert onClose={() => setError(null)}>{error}</Alert> : null}
      {notice ? <Alert tone="ok" onClose={() => setNotice(null)}>{notice}</Alert> : null}
      {items.length > 0 ? (
        <div className="card border-accent/50 p-5">
          <h2 className="flex items-center gap-2 text-base font-bold text-ink"><Icon name="users" className="h-4 w-4 text-accent" /> Invitations ({items.length})</h2>
          <ul className="mt-3 divide-y divide-line">
            {items.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3" data-invitation-id={inv.id}>
                {inv.invited_by ? <Avatar name={inv.invited_by.display_name || inv.invited_by.username} url={inv.invited_by.avatar_url} size="h-9 w-9" text="text-xs" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{inv.project_name}</p>
                  <p className="text-[13px] text-muted">
                    {inv.invited_by ? `${inv.invited_by.display_name || inv.invited_by.username} invited you` : 'You were invited'} as <RoleBadge role={inv.role} />
                  </p>
                </div>
                <button type="button" className="btn-secondary btn-sm" disabled={busy === inv.id} onClick={() => void answer(inv, false)} aria-label={`Decline invitation to ${inv.project_name}`}>
                  Decline
                </button>
                <button type="button" className="btn-primary btn-sm" disabled={busy === inv.id} onClick={() => void answer(inv, true)} aria-label={`Accept invitation to ${inv.project_name}`}>
                  <Icon name="check" /> {busy === inv.id ? 'Working…' : 'Accept'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
