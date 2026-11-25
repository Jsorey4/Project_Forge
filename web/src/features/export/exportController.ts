/**
 * @author Saaqib Shaik
 * @description Asks the backend to export a project's deadlines (.ics download, or Google / Outlook events
 *   after consent) and its data (.xlsx download, or a Google Sheets payload).
 * @traces SE-FR-19, SE-FR-20, UC-14, UC-15
 */
import { api, downloadFile } from '../../services/apiClient';
import type { CalendarAuthorization, CalendarExportResult, CalendarTarget, SheetsExportResult, SpreadsheetSection } from '../../shared/types';

export interface CalendarIncludes {
  include_project_deadline: boolean;
  include_task_due_dates: boolean;
  include_soft_deadlines: boolean;
}

type Provider = Exclude<CalendarTarget, 'ical'>;

export interface PendingExport {
  projectId: string;
  target: Provider;
  includes: CalendarIncludes;
  ticket: string;
  state: string;
}

const PENDING_KEY = 'pf_calendar_export';

export function takePendingExport(provider: string | undefined, state: string | null): PendingExport | null {
  const stored = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (!stored || !state) return null;
  try {
    const pending: PendingExport = JSON.parse(stored);
    return pending?.target === provider && pending.state === state ? pending : null;
  } catch {
    return null;
  }
}

export const exportController = {
  downloadIcs: (projectId: string, includes: CalendarIncludes) =>
    downloadFile(`/api/projects/${projectId}/export/calendar`, { target: 'ical', ...includes }, 'deadlines.ics'),
  async toProvider(projectId: string, target: Provider, includes: CalendarIncludes) {
    const auth = await api.post<CalendarAuthorization>(`/api/projects/${projectId}/export/calendar`, {
      target, oauth_consent: true, ...includes,
    });
    const pending: PendingExport = { projectId, target, includes, state: auth.state, ticket: auth.ticket };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    window.location.assign(auth.authorization_url);
  },
  complete(pending: PendingExport, code: string) {
    return api.post<CalendarExportResult>(`/api/projects/${pending.projectId}/export/calendar/complete`, {
      code, state: pending.state, ticket: pending.ticket,
    }, { retry: false, timeoutMs: 300_000 });
  },
  downloadXlsx: (projectId: string, sections: SpreadsheetSection[]) =>
    downloadFile(`/api/projects/${projectId}/export/spreadsheet`, { target: 'excel', sections }, 'export.xlsx'),
  toSheets: (projectId: string, sections: SpreadsheetSection[]) =>
    api.post<SheetsExportResult>(`/api/projects/${projectId}/export/spreadsheet`, { target: 'sheets', sections }),
};
