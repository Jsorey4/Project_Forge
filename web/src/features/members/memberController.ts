/**
 * @author Aashwat Singh
 * @description Calls the backend to list project members, invite someone by username or email, remove a
 *   member (optionally handing their open tasks to another member) and change a member's role.
 * @traces SE-FR-30, UC-19, UC-20
 */
import { api } from '../../services/apiClient';
import type { Invitation, Member, RemoveMemberResult, Role } from '../../shared/types';

export const memberController = {
  list: (projectId: string) => api.get<Member[]>(`/api/projects/${projectId}/members`),
  /** UC-19: sends a pending invitation; the person joins only by accepting it. */
  invite: (projectId: string, identifier: string, role: Role) =>
    api.post<Invitation>(`/api/projects/${projectId}/members/invite`, { identifier, role }),
  /** Owners / managers: the project's pending invitations. */
  invitations: (projectId: string) => api.get<Invitation[]>(`/api/projects/${projectId}/members/invitations`),
  cancelInvitation: (projectId: string, invitationId: string) =>
    api.del<Invitation>(`/api/projects/${projectId}/members/invitations/${invitationId}`),
  /** The signed-in person's own pending invitations, and their answers. */
  mine: () => api.get<Invitation[]>('/api/invitations'),
  accept: (invitationId: string) => api.post<Invitation>(`/api/invitations/${invitationId}/accept`, undefined, { retry: false }),
  decline: (invitationId: string) => api.post<Invitation>(`/api/invitations/${invitationId}/decline`, undefined, { retry: false }),
  remove: (projectId: string, userId: string, reassignToUserId?: string | null) =>
    api.del<RemoveMemberResult>(`/api/projects/${projectId}/members/${userId}`, { reassign_to_user_id: reassignToUserId ?? undefined }),
  changeRole: (projectId: string, userId: string, role: Role) =>
    api.patch<Member>(`/api/projects/${projectId}/members/${userId}/role`, { role }),
};
