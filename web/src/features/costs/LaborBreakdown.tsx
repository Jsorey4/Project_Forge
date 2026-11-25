/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`, Cost page)
 * @description "Labor breakdown" card under the stage-cost table: for each stage the hourly rate, estimated and
 *   actual hours, and estimated and actual labor dollars (rate x hours, rounded once to the cent by the server).
 *   Actual dollars turn red - with an icon, not color alone - when they exceed the estimate. Hours come from
 *   finished time entries tagged with the stage; hours with no stage get their own "No stage" row. This is a
 *   COMPARISON only: it is never added into the stage-cost total or any other total (ADR 004). Missing inputs
 *   show N/A. Rate and estimated hours are edited in place. Rows stack into labelled blocks below 1280 px
 *   instead of squeezing six columns into the card.
 * @traces SE-FR-01, SE-FR-04, SE-FR-05, SE-NFR-01, UC-01, UC-03
 */
import { useState } from 'react';
import type { CostSummary, StageCost } from '../../shared/types';
import { formatMoney } from '../../shared/format';
import { Alert, Icon } from '../../shared/ui';
import { toApiError } from '../../shared/useSave';
import { costController } from './costController';
import { NOT_AVAILABLE, hoursText, isOverEstimate, parseCents, parseLaborInput, summarizeLabor } from './model';

interface Props {
  projectId: string;
  summary: CostSummary;
  onChanged: () => void;
}

/** One labelled value. The label shows only when the row is stacked; at xl the column header carries it. */
function Cell({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="block text-xs font-semibold text-muted xl:hidden">{label}</span>
      <span className="block truncate tabular-nums text-ink xl:text-right">{children}</span>
    </div>
  );
}

const ROW = 'grid grid-cols-2 gap-x-4 gap-y-2 py-3 sm:grid-cols-5 xl:grid-cols-[minmax(0,1.8fr)_repeat(5,minmax(0,1fr))] xl:items-center';

function Dollars({ actual, estimate, currency }: { actual: string | null; estimate: string | null; currency: string }) {
  if (actual === null) return <span className="text-muted">{NOT_AVAILABLE}</span>;
  const over = isOverEstimate(actual, estimate);
  return (
    <span className={over ? 'inline-flex items-center gap-1 font-semibold text-danger xl:justify-end' : ''} title={over ? 'Over the estimate' : undefined}>
      {over ? <Icon name="alert" className="h-3.5 w-3.5" /> : null}
      {formatMoney(actual, currency)}
      {over ? <span className="sr-only"> (over the estimate)</span> : null}
    </span>
  );
}

function Money({ value, currency }: { value: string | null; currency: string }) {
  return value === null ? <span className="text-muted">{NOT_AVAILABLE}</span> : <>{formatMoney(value, currency)}</>;
}

export function LaborBreakdown({ projectId, summary, onChanged }: Props) {
  const [editing, setEditing] = useState<{ id: string; rate: string; hours: string } | null>(null);
  const [errors, setErrors] = useState<{ hourly_rate?: string; estimated_hours?: string }>({});
  const [rowError, setRowError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stages = summary.stage_costs;
  const totals = summarizeLabor(stages, summary.unstaged_hours);
  const hasUnstaged = parseCents(summary.unstaged_hours) > 0n;

  const startEdit = (s: StageCost) => {
    setEditing({ id: s.id, rate: s.hourly_rate ?? '', hours: s.estimated_hours ?? '' });
    setErrors({});
    setRowError(null);
  };

  const save = async (s: StageCost) => {
    if (!editing) return;
    const parsed = parseLaborInput(editing.rate, editing.hours);
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length) return;
    setSaving(true);
    try {
      await costController.updateStage(projectId, s.id, parsed.value);
      setEditing(null);
      setRowError(null);
      onChanged();
    } catch (err) {
      setRowError(toApiError(err).detail); // the entered values stay in the boxes so the user can retry
    } finally {
      setSaving(false);
    }
  };

  if (stages.length === 0) {
    return <p className="text-sm text-muted">Add a stage above, then set its hourly rate and estimated hours to compare labor.</p>;
  }

  return (
    <div>
      {rowError ? <div className="mb-3"><Alert onClose={() => setRowError(null)}>{rowError}</Alert></div> : null}
      <div role="table" aria-label="Labor breakdown by stage">
        <div role="row" className="hidden border-b border-line pb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted xl:grid xl:grid-cols-[minmax(0,1.8fr)_repeat(5,minmax(0,1fr))]">
          <span role="columnheader">Stage</span>
          <span role="columnheader" className="text-right">Rate ($/h)</span>
          <span role="columnheader" className="text-right">Est hrs</span>
          <span role="columnheader" className="text-right">Act hrs</span>
          <span role="columnheader" className="text-right">Est $</span>
          <span role="columnheader" className="text-right">Act $</span>
        </div>
        <div className="[&>[role=row]]:border-b [&>[role=row]]:border-line">
          {stages.map((s) => {
            const isEditing = editing?.id === s.id;
            return (
              <div key={s.id} role="row" className={ROW}>
                <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 sm:col-span-5 xl:col-span-1">
                  <span role="rowheader" className="truncate font-semibold text-ink">{s.stage_name}</span>
                  {isEditing ? (
                    <span className="flex shrink-0">
                      <button type="button" className="btn-ghost p-1.5" onClick={() => void save(s)} disabled={saving} aria-label={`Save labor for ${s.stage_name}`}><Icon name="check" /></button>
                      <button type="button" className="btn-ghost p-1.5" onClick={() => { setEditing(null); setErrors({}); }} aria-label="Cancel edit"><Icon name="x" /></button>
                    </span>
                  ) : (
                    <button type="button" className="btn-ghost shrink-0 p-1.5" onClick={() => startEdit(s)} aria-label={`Edit labor for ${s.stage_name}`}><Icon name="edit" /></button>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <div className="min-w-0">
                      <label className="block text-xs font-semibold text-muted xl:hidden" htmlFor={`rate-${s.id}`}>Rate ($/h)</label>
                      <input id={`rate-${s.id}`} className="input py-1 text-right" inputMode="decimal" value={editing.rate} placeholder="Rate" aria-label={`Hourly rate for ${s.stage_name}`} onChange={(e) => setEditing({ ...editing, rate: e.target.value })} />
                      {errors.hourly_rate ? <p className="mt-1 text-xs text-danger">{errors.hourly_rate}</p> : null}
                    </div>
                    <div className="min-w-0">
                      <label className="block text-xs font-semibold text-muted xl:hidden" htmlFor={`hrs-${s.id}`}>Est hrs</label>
                      <input id={`hrs-${s.id}`} className="input py-1 text-right" inputMode="decimal" value={editing.hours} placeholder="Hours" aria-label={`Estimated hours for ${s.stage_name}`} onChange={(e) => setEditing({ ...editing, hours: e.target.value })} />
                      {errors.estimated_hours ? <p className="mt-1 text-xs text-danger">{errors.estimated_hours}</p> : null}
                    </div>
                  </>
                ) : (
                  <>
                    <Cell label="Rate ($/h)">{s.hourly_rate === null ? <span className="text-muted">{NOT_AVAILABLE}</span> : formatMoney(s.hourly_rate, summary.currency)}</Cell>
                    <Cell label="Est hrs">{s.estimated_hours === null ? <span className="text-muted">{NOT_AVAILABLE}</span> : hoursText(s.estimated_hours)}</Cell>
                  </>
                )}
                <Cell label="Act hrs">{hoursText(s.actual_hours)}</Cell>
                <Cell label="Est $"><Money value={s.labor_estimated} currency={summary.currency} /></Cell>
                <Cell label="Act $"><Dollars actual={s.labor_actual} estimate={s.labor_estimated} currency={summary.currency} /></Cell>
              </div>
            );
          })}
          {hasUnstaged ? (
            <div role="row" className={ROW}>
              <div className="col-span-2 sm:col-span-5 xl:col-span-1"><span role="rowheader" className="font-semibold text-muted">No stage</span></div>
              <Cell label="Rate ($/h)"><span className="text-muted">{NOT_AVAILABLE}</span></Cell>
              <Cell label="Est hrs"><span className="text-muted">{NOT_AVAILABLE}</span></Cell>
              <Cell label="Act hrs">{hoursText(summary.unstaged_hours)}</Cell>
              <Cell label="Est $"><span className="text-muted">{NOT_AVAILABLE}</span></Cell>
              <Cell label="Act $"><span className="text-muted">{NOT_AVAILABLE}</span></Cell>
            </div>
          ) : null}
          <div role="row" className={`${ROW} font-bold`}>
            <div className="col-span-2 sm:col-span-5 xl:col-span-1"><span role="rowheader" className="text-ink">{totals.label}</span></div>
            <Cell label="Rate ($/h)"><span className="text-muted">—</span></Cell>
            <Cell label="Est hrs">{totals.estimatedHours === null ? <span className="text-muted">{NOT_AVAILABLE}</span> : hoursText(totals.estimatedHours)}</Cell>
            <Cell label="Act hrs">{hoursText(totals.actualHours)}</Cell>
            <Cell label="Est $"><Money value={summary.labor_estimated_total} currency={summary.currency} /></Cell>
            <Cell label="Act $"><Dollars actual={summary.labor_actual_total} estimate={summary.labor_estimated_total} currency={summary.currency} /></Cell>
          </div>
        </div>
      </div>
      <p className="mt-3 flex items-start gap-2 text-[13px] text-muted">
        <Icon name="info" className="mt-0.5 h-4 w-4" />
        <span>Actual hours come from finished time entries logged against each stage; running timers are not counted. Hours with no stage have no rate, so they are not in the dollar totals. {totals.label === 'Subtotal' ? 'Dollar totals leave out stages without a rate or estimated hours.' : ''}</span>
      </p>
    </div>
  );
}
