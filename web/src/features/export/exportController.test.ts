/** eLeet Coderz — UC-14 / SE-FR-19 browser handoff and one-time calendar callback. */
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../services/apiClient';
import { exportController, takePendingExport } from './exportController';

vi.mock('../../services/apiClient', () => ({ api: { post: vi.fn() } }));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const selection = { include_project_deadline: false, include_task_due_dates: true, include_soft_deadlines: true };

async function redirect() {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    setItem: storage.set.bind(storage), getItem: storage.get.bind(storage), removeItem: storage.delete.bind(storage),
  });
  const assign = vi.fn();
  vi.stubGlobal('window', { location: { assign } });
  vi.mocked(api.post).mockResolvedValueOnce({ authorization_url: 'https://accounts.google.com/authorize', state: 'nonce', ticket: 'ticket' });
  await exportController.toProvider('project', 'google', selection);
  expect(assign).toHaveBeenCalledWith('https://accounts.google.com/authorize');
}

it('UC-14 sends the selected deadlines and consumes a matching callback only once (SE-FR-19)', async () => {
  await redirect();
  expect(api.post).toHaveBeenCalledWith('/api/projects/project/export/calendar', { target: 'google', oauth_consent: true, ...selection });
  const pending = takePendingExport('google', 'nonce');
  expect(pending?.includes).toEqual(selection);
  expect(takePendingExport('google', 'nonce')).toBeNull();
  await exportController.complete(pending!, 'code');
  expect(api.post).toHaveBeenLastCalledWith('/api/projects/project/export/calendar/complete',
    { code: 'code', state: 'nonce', ticket: 'ticket' }, expect.objectContaining({ retry: false }));
});

it.each([['outlook', 'nonce'], ['google', 'other-state']])(
  'UC-14 rejects mismatched callback %s / %s (SE-FR-19)', async (provider, state) => {
    await redirect();
    expect(takePendingExport(provider, state)).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);
