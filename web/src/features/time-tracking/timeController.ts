/**
 * @author Jon Sorey
 * @description Calls the backend to set estimated / assigned hours (managers), log actual hours, run the
 *   start / pause / resume / stop timer, and list or delete time entries.
 *   A timer or manual entry can name the cost stage it belongs to (labor breakdown).
 * @traces SE-FR-04, SE-FR-01, UC-03, UC-04
 */
import { api } from '../../services/apiClient';
import type { StageName, TaskHours, TimeEntry } from '../../shared/types';

export const timeController = {
  /** Stage names of a project (any member): the choices when tagging time with a cost stage. */
  stages: (projectId: string) => api.get<StageName[]>(`/api/projects/${projectId}/stages`),
  setHours: (projectId: string, taskId: string, values: { estimated_hours?: number | null; assigned_hours?: number | null; actual_hours?: number; stage_cost_id?: string | null; work_date?: string; note?: string }) =>
    api.post<TaskHours>(`/api/projects/${projectId}/tasks/${taskId}/hours`, values),
  active: () => api.get<TimeEntry | null>('/api/time-entries/timer/active'),
  start: (taskId: string, note = '', stageCostId: string | null = null) =>
    api.post<TimeEntry>('/api/time-entries/timer/start', { task_id: taskId, note, stage_cost_id: stageCostId }),
  pause: () => api.post<TimeEntry>('/api/time-entries/timer/pause', {}),
  resume: () => api.post<TimeEntry>('/api/time-entries/timer/resume', {}),
  stop: () => api.post<TimeEntry>('/api/time-entries/timer/stop', {}),
  list: (filters: { project_id?: string; user_id?: string; start_date?: string; end_date?: string } = {}) =>
    api.get<TimeEntry[]>('/api/time-entries', filters),
  remove: (entryId: string) => api.del<void>(`/api/time-entries/${entryId}`),
};
