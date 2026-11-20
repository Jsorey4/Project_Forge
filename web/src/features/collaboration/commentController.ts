/**
 * @author Aashwat Singh
 * @description Calls the backend to read and post task comments (which may contain @mentions), delete a
 *   comment, and read / mark-read notifications.
 * @traces SE-FR-28, SE-FR-29, UC-21, UC-22
 */
import { api } from '../../services/apiClient';
import type { Comment, CommentCreateResult, Notification, NotificationList, ReminderRunResult } from '../../shared/types';

export const commentController = {
  list: (taskId: string) => api.get<Comment[]>(`/api/tasks/${taskId}/comments`),
  create: (taskId: string, body: string) => api.post<CommentCreateResult>(`/api/tasks/${taskId}/comments`, { body }),
  remove: (commentId: string) => api.del<void>(`/api/comments/${commentId}`),
};

/** Fired after the unread count changes on this device, so the sidebar badge can re-count (UC-22). */
export const UNREAD_CHANGED = 'pf:unread-changed';
const announceUnread = <T,>(result: T): T => {
  window.dispatchEvent(new Event(UNREAD_CHANGED));
  return result;
};

export const notificationController = {
  list: (unreadOnly = false) => api.get<NotificationList>('/api/notifications', { unread_only: unreadOnly }),
  markRead: (id: string) => api.patch<Notification>(`/api/notifications/${id}/read`).then(announceUnread),
  markAllRead: () => api.patch<NotificationList>('/api/notifications/read-all').then(announceUnread),
  /** UC-22: runs the deadline-reminder job now. */
  runReminders: () => api.post<ReminderRunResult>('/api/notifications/reminders/run'),
};
