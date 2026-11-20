/**
 * @author Aashwat Singh
 * @description The project's feature lists (TaskList) above the board: one chip per list with its task
 *   count - click a chip to show only that list's tasks - plus, for owners and managers, "New list", rename
 *   and delete. Deleting a list never deletes its tasks; they simply have no list afterwards. Members see the
 *   lists but cannot change them; the server enforces the same rule.
 * @traces SE-FR-18, SE-FR-27, SE-NFR-11, UC-18
 */
import { useState } from 'react';
import type { Task, TaskList } from '../../shared/types';
import { Alert, Icon } from '../../shared/ui';
import { toApiError } from '../../shared/useSave';
import { taskController } from './taskController';

export function listCounts(tasks: Pick<Task, 'list_id'>[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const t of tasks) counts.set(t.list_id, (counts.get(t.list_id) ?? 0) + 1);
  return counts;
}

export function validateListName(name: string, existing: Pick<TaskList, 'id' | 'name'>[], ignoreId?: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the list a name';
  if (trimmed.length > 80) return 'List names are limited to 80 characters';
  if (existing.some((l) => l.id !== ignoreId && l.name.trim().toLowerCase() === trimmed.toLowerCase())) return 'There is already a list with that name';
  return undefined;
}

interface Props {
  projectId: string;
  lists: TaskList[];
  tasks: Task[];
  canManage: boolean;
  activeListId: string;
  onFilter: (listId: string) => void;
  onChanged: () => void | Promise<void>;
}

export function ListManager({ projectId, lists, tasks, canManage, activeListId, onFilter, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = listCounts(tasks);

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (err) {
      setError(toApiError(err).detail);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const problem = validateListName(name, lists);
    if (problem) return setError(problem);
    if (await run(() => taskController.createList(projectId, name.trim()))) {
      setName('');
      setAdding(false);
    }
  };

  const rename = async (list: TaskList) => {
    const problem = validateListName(editName, lists, list.id);
    if (problem) return setError(problem);
    if (await run(() => taskController.renameList(list.id, editName.trim()))) setEditing(null);
  };

  const remove = async (list: TaskList) => {
    const n = counts.get(list.id) ?? 0;
    if (!window.confirm(`Delete the list "${list.name}"?${n ? ` Its ${n} task${n === 1 ? '' : 's'} will stay on the board without a list.` : ''}`)) return;
    if (activeListId === list.id) onFilter('');
    await run(() => taskController.deleteList(list.id));
  };

  return (
    <section className="mb-5" aria-label="Feature lists">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Lists</span>
        <button type="button" onClick={() => onFilter('')} aria-pressed={activeListId === ''} className={`rounded-full border px-3 py-1 text-[13px] font-semibold ${activeListId === '' ? 'border-brand bg-brand/10 text-brand' : 'border-line text-body hover:border-line-strong'}`}>
          All <span className="ml-1 text-muted">{tasks.length}</span>
        </button>
        {lists.map((l) =>
          editing === l.id ? (
            <form key={l.id} className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void rename(l); }}>
              <input className="input h-8 w-40 py-0 text-[13px]" value={editName} maxLength={80} autoFocus aria-label={`New name for ${l.name}`} onChange={(e) => setEditName(e.target.value)} />
              <button type="submit" className="btn-primary btn-sm" disabled={busy}>Save</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(null); setError(null); }}>Cancel</button>
            </form>
          ) : (
            <span key={l.id} className={`inline-flex items-center rounded-full border ${activeListId === l.id ? 'border-brand bg-brand/10' : 'border-line'}`}>
              <button type="button" onClick={() => onFilter(activeListId === l.id ? '' : l.id)} aria-pressed={activeListId === l.id} className={`px-3 py-1 text-[13px] font-semibold ${activeListId === l.id ? 'text-brand' : 'text-body hover:text-ink'}`}>
                {l.name} <span className="ml-1 text-muted">{counts.get(l.id) ?? 0}</span>
              </button>
              {canManage ? (
                <>
                  <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => { setEditing(l.id); setEditName(l.name); setError(null); }} aria-label={`Rename list ${l.name}`}><Icon name="edit" className="h-3 w-3" /></button>
                  <button type="button" className="pr-2 pl-1 text-muted hover:text-danger" onClick={() => void remove(l)} aria-label={`Delete list ${l.name}`}><Icon name="trash" className="h-3 w-3" /></button>
                </>
              ) : null}
            </span>
          ),
        )}
        {(counts.get(null) ?? 0) > 0 ? <span className="rounded-full border border-dashed border-line px-3 py-1 text-[13px] text-muted">No list <span className="ml-1">{counts.get(null)}</span></span> : null}
        {canManage ? (
          adding ? (
            <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <input className="input h-8 w-44 py-0 text-[13px]" placeholder="List name" value={name} maxLength={80} autoFocus aria-label="New list name" onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn-primary btn-sm" disabled={busy}>Add list</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setAdding(false); setName(''); setError(null); }}>Cancel</button>
            </form>
          ) : (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(true)}><Icon name="plus" className="h-3.5 w-3.5" /> New list</button>
          )
        ) : null}
      </div>
      {error ? <div className="mt-2"><Alert onClose={() => setError(null)}>{error}</Alert></div> : null}
    </section>
  );
}
