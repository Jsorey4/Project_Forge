/**
 * @author Aashwat Singh
 * @description Confirmation dialog for removing a member. Shows how many unfinished tasks they hold and lets
 *   the remover pick who takes them over (or leave them unassigned). The server does the removal and the
 *   reassignment in one all-or-nothing step.
 * @traces SE-FR-30, UC-19
 */
import { useState } from 'react';
import type { Member } from '../../shared/types';
import { Select } from '../../components/Select';
import { Alert, Avatar, Modal, RetryBanner } from '../../shared/ui';
import { useSave } from '../../shared/useSave';
import { memberController } from './memberController';

interface Props {
  open: boolean;
  projectId: string;
  member: Member | null;
  members: Member[];
  onClose: () => void;
  onRemoved: (message: string) => void;
}

export function ReassignTasksModal({ open, projectId, member, members, onClose, onRemoved }: Props) {
  const [target, setTarget] = useState('');
  const save = useSave(
    () => memberController.remove(projectId, member!.user_id, target || null),
    (result) => {
      const who = members.find((m) => m.user_id === result.reassigned_to);
      onRemoved(
        result.reassigned_task_count > 0 && who
          ? `${member!.display_name} was removed and ${result.reassigned_task_count} open task(s) moved to ${who.display_name}.`
          : `${member!.display_name} was removed. Their open tasks are now unassigned.`,
      );
      setTarget('');
    },
  );
  if (!member) return null;
  const candidates = members.filter((m) => m.user_id !== member.user_id);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Remove member"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-danger" onClick={() => void save.run()} disabled={save.saving}>{save.saving ? 'Removing…' : 'Remove member'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <RetryBanner error={save.networkError} onRetry={save.retry} onCancel={save.cancel} busy={save.saving} />
        {save.error ? <Alert>{save.error.detail}</Alert> : null}
        <div className="flex items-center gap-3">
          <Avatar name={member.display_name} url={member.avatar_url} size="h-10 w-10" />
          <div>
            <p className="font-semibold">{member.display_name}</p>
            <p className="text-sm text-muted">@{member.username} · {member.open_task_count} open task{member.open_task_count === 1 ? '' : 's'}</p>
          </div>
        </div>
        {member.open_task_count > 0 ? (
          <div className="block">
            <label className="label" htmlFor="reassign-target">Reassign their open tasks to</label>
            <Select id="reassign-target" value={target} onChange={setTarget} options={[{ value: '', label: 'Leave unassigned' }, ...candidates.map((m) => ({ value: m.user_id, label: `${m.display_name} (@${m.username})` }))]} />
          </div>
        ) : (
          <p className="text-sm text-muted">They have no open tasks, so nothing needs to be reassigned.</p>
        )}
      </div>
    </Modal>
  );
}
