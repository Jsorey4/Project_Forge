/**
 * @author Aashwat Singh
 * @description Unit tests for the one frontend permission helper. It only decides which buttons to show; the
 *   server re-checks everything. The table here is the proposed role matrix (owner / manager / member).
 * @traces SE-FR-26, SE-FR-30, SE-NFR-11, UC-18, UC-19, UC-20
 */
import { describe, expect, it } from 'vitest';
import { ALL_ROLES, MANAGER_ROLES, grantableRoles, hasProjectRole, isManager, isOwner } from './permissions';
import { Membership, canEditTask } from '../features/tasks/model';

describe('role matrix helpers', () => {
  it('UC-19: owners and managers manage people; members and strangers do not', () => {
    expect(isManager('owner')).toBe(true);
    expect(isManager('manager')).toBe(true);
    expect(isManager('member')).toBe(false);
    expect(isManager(null)).toBe(false);
    expect(isManager(undefined)).toBe(false);
    expect([...MANAGER_ROLES]).toEqual(['owner', 'manager']);
    expect([...ALL_ROLES]).toEqual(['owner', 'manager', 'member']);
    expect(hasProjectRole('member', ['owner'])).toBe(false);
  });

  it('UC-19 / UC-20: only an owner can hand out the owner role', () => {
    expect(grantableRoles('owner')).toEqual(['owner', 'manager', 'member']);
    expect(grantableRoles('manager')).toEqual(['manager', 'member']);
    expect(grantableRoles('member')).toEqual([]);
    expect(grantableRoles(null)).toEqual([]);
    expect(isOwner('owner')).toBe(true);
    expect(isOwner('manager')).toBe(false);
  });

  it('UC-18: canAssignTasks is owner / manager; a member updates only tasks assigned to them', () => {
    expect(Membership.canAssignTasks('owner')).toBe(true);
    expect(Membership.canAssignTasks('manager')).toBe(true);
    expect(Membership.canAssignTasks('member')).toBe(false);
    expect(canEditTask('member', { assignee_id: 'me' }, 'me')).toBe(true);
    expect(canEditTask('member', { assignee_id: 'you' }, 'me')).toBe(false);
    expect(canEditTask('member', { assignee_id: null }, 'me')).toBe(false);
    expect(canEditTask('member', { assignee_id: 'me' }, undefined)).toBe(false);
    expect(canEditTask('manager', { assignee_id: 'you' }, 'me')).toBe(true);
    expect(canEditTask(null, { assignee_id: 'me' }, 'me')).toBe(false);
  });
});
