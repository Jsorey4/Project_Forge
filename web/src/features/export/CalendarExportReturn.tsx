/** eLeet Coderz — complete an authorized calendar export and show its outcome (UC-14, SE-FR-19). */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toApiError } from '../../shared/useSave';
import { exportController, takePendingExport, type PendingExport } from './exportController';

export function CalendarExportReturn() {
  const { provider } = useParams();
  const started = useRef(false);
  const [message, setMessage] = useState('Adding your deadlines…');
  const [retry, setRetry] = useState<PendingExport | null>(null);

  useEffect(() => {
    // React StrictMode runs effects twice. Consume this tab’s callback and single-use code once.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState(window.history.state, '', window.location.pathname);
    const pending = takePendingExport(provider, params.get('state'));
    if (!pending) {
      setMessage('This authorization does not match a pending export. Return to Calendar to start again.');
      return;
    }
    const code = params.get('code');
    if (params.get('error') === 'access_denied') {
      setMessage('Export cancelled. No deadlines were shared.');
    } else if (params.has('error') || !code) {
      setMessage('Calendar authorization failed. Try signing in again.');
      setRetry(pending);
    } else {
      exportController.complete(pending, code)
        .then(result => setMessage(result.message))
        .catch(error => {
          setMessage(toApiError(error).detail);
          setRetry(pending);
        });
    }
  }, [provider]);

  async function restart(pending: PendingExport) {
    setRetry(null);
    setMessage('Opening calendar authorization…');
    try {
      await exportController.toProvider(pending.projectId, pending.target, pending.includes);
    } catch (error) {
      setMessage(toApiError(error).detail);
      setRetry(pending);
    }
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Calendar export</h1>
      <p role="status">{message}</p>
      <div className="flex gap-2">
        {retry && <button className="btn-primary" onClick={() => void restart(retry)}>Retry export</button>}
        <Link className="btn-secondary" to="/calendar">Return to Calendar</Link>
      </div>
    </main>
  );
}
