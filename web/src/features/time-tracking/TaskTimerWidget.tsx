/**
 * @author Jon Sorey
 * @description Start / pause / resume / stop timer for one task with a live HH:MM:SS clock. The "hero" look
 *   matches the Timer card in time-tracking.html (big centered clock, task and project, Stop + Pause
 *   buttons); the compact look sits inside the task screen. Only one timer can run at a time per person;
 *   the server rejects a second start and the widget explains why. When the project has cost stages, a stage
 *   picker on its own row above the clock tags the new timer with the stage it is worked on (labor breakdown;
 *   UI idea ported from Preethi Seereddy's frontend).
 * @traces SE-FR-04, SE-FR-01, UC-04
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Select } from '../../components/Select';
import { useRealtime } from '../../services/realtimeClient';
import type { StageName, TimeEntry } from '../../shared/types';
import { formatDuration } from '../../shared/format';
import { Alert, Icon } from '../../shared/ui';
import { toApiError } from '../../shared/useSave';
import { liveElapsed } from './model';
import { timeController } from './timeController';

interface Props {
  taskId: string;
  /** Project of the task; when given, the project's cost stages can be picked before starting. */
  projectId?: string;
  taskTitle?: string;
  projectName?: string;
  canTrack: boolean;
  variant?: 'hero' | 'compact';
  onStopped?: (entry: TimeEntry) => void;
  onActiveChange?: (entry: TimeEntry | null) => void;
}

export function TaskTimerWidget({ taskId, projectId, taskTitle, projectName, canTrack, variant = 'compact', onStopped, onActiveChange }: Props) {
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageName[]>([]);
  const [stageId, setStageId] = useState('');
  const stageFieldId = useId();

  // Stage names are readable by every member (no amounts), so the picker works for assignees too.
  useEffect(() => {
    setStageId('');
    setStages([]);
    if (!projectId) return;
    let live = true;
    timeController.stages(projectId).then((rows) => live && setStages(rows)).catch(() => live && setStages([]));
    return () => {
      live = false;
    };
  }, [projectId]);

  const refresh = useCallback(async () => {
    try {
      const entry = await timeController.active();
      setActive(entry);
      setFetchedAt(Date.now());
      onActiveChange?.(entry);
    } catch (err) {
      setError(toApiError(err).detail);
    }
  }, [onActiveChange]);

  useEffect(() => void refresh(), [refresh]);
  useRealtime('timer', () => void refresh());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const act = async (fn: () => Promise<TimeEntry>, after?: (e: TimeEntry) => void) => {
    setBusy(true);
    setError(null);
    try {
      const entry = await fn();
      after?.(entry);
      await refresh();
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      setBusy(false);
    }
  };

  const onThisTask = active?.task_id === taskId;
  const elapsed = onThisTask && active ? liveElapsed(active, fetchedAt, now) : 0;

  if (!canTrack) {
    return <p className="text-sm text-muted">Only the assignee (or a manager) can track time on this task.</p>;
  }

  // Hero buttons are at least 120 px wide and share the row; when the card is too narrow for two they wrap
  // onto their own lines instead of spilling out of the card (1024-1280 px, three-column layout).
  const heroBtn = variant === 'hero' ? 'min-w-[120px] max-w-[150px] flex-1' : '';
  const buttons = !onThisTask ? (
    <button type="button" className={`btn-primary ${heroBtn}`} disabled={busy || !!active} onClick={() => void act(() => timeController.start(taskId, '', stageId || null))}>
      <Icon name="play" /> Start
    </button>
  ) : (
    <>
      <button type="button" className={`btn-secondary ${heroBtn}`} disabled={busy} onClick={() => void act(timeController.stop, onStopped)}>
        <Icon name="stop" /> Stop
      </button>
      {active?.is_paused ? (
        <button type="button" className={`btn-primary ${heroBtn}`} disabled={busy} onClick={() => void act(timeController.resume)}>
          <Icon name="play" /> Resume
        </button>
      ) : (
        <button type="button" className={`btn-primary ${heroBtn}`} disabled={busy} onClick={() => void act(timeController.pause)}>
          <Icon name="pause" /> Pause
        </button>
      )}
    </>
  );
  const stagePicker =
    stages.length > 0 ? (
      <div className={variant === 'hero' ? 'mb-6 text-left' : ''}>
        <label className="label" htmlFor={stageFieldId}>Cost stage <span className="font-normal text-muted">(optional)</span></label>
        <Select
          id={stageFieldId}
          value={onThisTask && active ? active.stage_cost_id ?? '' : stageId}
          onChange={setStageId}
          disabled={!!active}
          options={[{ value: '', label: 'No stage' }, ...stages.map((s) => ({ value: s.id, label: s.stage_name }))]}
        />
      </div>
    ) : null;
  const status = onThisTask ? (active?.is_paused ? 'Paused' : 'Running') : active ? `Timer running on “${active.task_title}”` : 'Ready';

  if (variant === 'hero') {
    return (
      // The wrapper is a size container so the clock scales with the card (cqw) and never outgrows it:
      // 8 tabular digits are about 4.1 em wide, so 22 cqw leaves roughly 10% spare; 52 px is the full size.
      <div className="text-center [container-type:inline-size]">
        {stagePicker}
        {error ? <div className="mb-3 text-left"><Alert onClose={() => setError(null)}>{error}</Alert></div> : null}
        <p className="font-extrabold tabular-nums tracking-[0.02em] text-ink text-[length:clamp(28px,22cqw,52px)] leading-[1.15]" aria-live="polite" aria-label="Elapsed time">{formatDuration(elapsed)}</p>
        <p className="mt-3 text-[15px] font-semibold leading-[22px] text-ink">{taskTitle}</p>
        <p className="text-sm text-muted">{projectName}{!onThisTask && active ? ` · ${status}` : ''}</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">{buttons}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stagePicker}
      {error ? <Alert onClose={() => setError(null)}>{error}</Alert> : null}
      {/* flex-wrap: on a phone the clock and the Stop / Pause pair do not fit on one line, so the buttons drop below. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-btn border border-line bg-surface-2 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-3xl font-bold tabular-nums text-ink" aria-live="polite" aria-label="Elapsed time">{formatDuration(elapsed)}</p>
          <p className="text-xs text-muted">{status}{!onThisTask && !active && taskTitle ? ` · ${taskTitle}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">{buttons}</div>
      </div>
    </div>
  );
}
