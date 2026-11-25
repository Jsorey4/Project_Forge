/**
 * @author Tyler Gaines - matches profile.html
 * @description The "Notification preferences" and "Connections" cards on Profile & settings.
 *   Notification preferences: four switches (task assignments, mentions, deadline reminders, project
 *   updates) saved to the user's profile the moment they are flipped; the server reads the same values
 *   before it creates a notification, so a muted kind is never delivered. Calendar preferences skip the local confirmation before provider sign-in.
 * @traces SE-FR-19, SE-FR-20, SE-FR-29, UC-14, UC-15, UC-22
 */
import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import type { ConnectedProvider, NotificationPrefs, ProfileUpdate } from '../../shared/types';
import { formatDate } from '../../shared/format';
import { Alert, Card, Icon, Toggle } from '../../shared/ui';
import { toApiError } from '../../shared/useSave';
import { settingsController } from './settingsController';

export const NOTIFICATION_SWITCHES: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'task_assignments', label: 'Task assignments', hint: 'A task is assigned or handed over to you' },
  { key: 'mentions', label: 'Mentions', hint: 'Someone @mentions you in a comment' },
  { key: 'deadline_reminders', label: 'Deadline reminders', hint: 'Your tasks and soft deadlines due within 24 hours' },
  { key: 'project_updates', label: 'Project updates', hint: 'A task you own or created changes status' },
];

export const CONNECTIONS: { provider: ConnectedProvider; label: string; hint: string }[] = [
  { provider: 'google_calendar', label: 'Google Calendar', hint: 'Skip the ProjectForge confirmation before provider sign-in' },
  { provider: 'outlook', label: 'Outlook', hint: 'Skip the ProjectForge confirmation before provider sign-in' },
  { provider: 'google_sheets', label: 'Google Sheets', hint: 'Export project data to a new sheet' },
];

/** Saves one change to the profile and keeps the signed-in user in sync; returns an error message or null. */
function useProfilePatch() {
  const { setUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const patch = async (key: string, update: ProfileUpdate) => {
    setPending(key);
    setError(null);
    try {
      setUser(await settingsController.updateProfile(update));
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      setPending(null);
    }
  };
  return { error, setError, pending, patch };
}

function PrefRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-[22px] text-ink">{label}</p>
        <p className="text-[13px] leading-[18px] text-muted">{hint}</p>
      </div>
      {children}
    </div>
  );
}

export function NotificationPrefsCard() {
  const { user } = useAuth();
  const { error, setError, pending, patch } = useProfilePatch();
  if (!user) return null;
  const prefs = user.notification_prefs;
  return (
    <Card title="Notification preferences">
      {error ? <div className="mb-3"><Alert onClose={() => setError(null)}>{error}</Alert></div> : null}
      <div>
        {NOTIFICATION_SWITCHES.map(({ key, label, hint }) => (
          <PrefRow key={key} label={label} hint={hint}>
            <Toggle checked={prefs[key]} label={label} disabled={pending === key} onChange={(on) => void patch(key, { notification_prefs: { [key]: on } })} />
          </PrefRow>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-muted">Role and membership changes are always sent.</p>
    </Card>
  );
}

export function ConnectedAccountsCard() {
  const { user } = useAuth();
  const { error, setError, pending, patch } = useProfilePatch();
  if (!user) return null;
  return (
    <Card title="Connections">
      {error ? <div className="mb-3"><Alert onClose={() => setError(null)}>{error}</Alert></div> : null}
      <div>
        {CONNECTIONS.map(({ provider, label, hint }) => {
          const account = user.connected_accounts[provider];
          const busy = pending === provider;
          const enable = provider === 'google_sheets' ? 'Connect' : 'Enable';
          const disable = provider === 'google_sheets' ? 'Disconnect' : 'Disable';
          return (
            <PrefRow key={provider} label={label} hint={account.connected && account.connected_at ? `${hint} · since ${formatDate(account.connected_at)}` : hint}>
              {account.connected ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="btn-sm inline-flex items-center gap-1.5 rounded-btn border border-ok/40 bg-ok/15 font-semibold text-ok" data-testid={`conn-${provider}`}>
                    <Icon name="check" className="h-3.5 w-3.5" /> {provider === 'google_sheets' ? 'Connected' : 'Enabled'}
                  </span>
                  <button type="button" className="btn-secondary btn-sm" disabled={busy} aria-label={`${disable} ${label}`} onClick={() => void patch(provider, { connected_accounts: { [provider]: false } })}>
                    {busy ? '…' : disable}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-primary btn-sm shrink-0" disabled={busy} aria-label={`${enable} ${label}`} onClick={() => void patch(provider, { connected_accounts: { [provider]: true } })}>
                  {busy ? 'Saving…' : enable}
                </button>
              )}
            </PrefRow>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-muted">Google Calendar and Outlook ask you to authorize access when you export deadlines.</p>
    </Card>
  );
}
