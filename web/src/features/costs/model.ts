/**
 * @author Jon Sorey
 * @description Exact money math in the browser. Amounts are handled as whole cents (BigInt), never as
 *   floating point, and rounded half-up to the cent - the same rule as the server's Decimal(ROUND_HALF_UP).
 *   calculateStageCostSummary() returns the stage-cost sum labelled "Total" or "Subtotal". Bids, budgets
 *   and expenses are never added to it.
 *   The labor-breakdown helpers (over-estimate check, N/A text, totals label, rate / hours input parsing) use the
 *   same cent math; labor dollars are a comparison and are never added into the stage-cost total.
 * @traces SE-NFR-01, SE-FR-01, SE-FR-02, SE-FR-03, SE-FR-04, UC-01
 */
import type { ExpenseCategory } from '../../shared/types';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'labor', label: 'Labor' },
  { value: 'materials', label: 'Materials' },
  { value: 'software', label: 'Software' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'travel', label: 'Travel' },
  { value: 'services', label: 'Services' },
  { value: 'other', label: 'Other' },
];

const AMOUNT_RE = /^\s*(\d+)(?:\.(\d*))?\s*$/;

export function isValidAmount(value: string): boolean {
  return AMOUNT_RE.test(value);
}

/** "1234.565" -> 123457n (cents, half-up). Throws on malformed or negative input. */
export function parseCents(value: string): bigint {
  const match = AMOUNT_RE.exec(value);
  if (!match) throw new Error(`Invalid amount: ${value}`);
  const whole = BigInt(match[1]);
  const frac = (match[2] ?? '').padEnd(3, '0');
  let cents = whole * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n;
  return cents;
}

export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

export function normalizeAmount(value: string): string {
  return formatCents(parseCents(value));
}

export function sumAmounts(amounts: string[]): string {
  return formatCents(amounts.reduce((acc, a) => acc + parseCents(a), 0n));
}

export function calculateStageCostSummary(stages: { amount: string }[], isPartial: boolean): { sum: string; label: 'Total' | 'Subtotal' } {
  return { sum: sumAmounts(stages.map((s) => s.amount)), label: isPartial ? 'Subtotal' : 'Total' };
}

/** Difference between two money strings (e.g. budget remaining), exact to the cent. */
export function subtractAmounts(a: string, b: string): string {
  return formatCents(parseCents(a) - parseCents(b));
}

export interface ExpenseForm {
  category: string;
  description: string;
  amount: string;
  expense_date: string;
}

export function validateExpense(form: ExpenseForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!EXPENSE_CATEGORIES.some((c) => c.value === form.category)) errors.category = 'Choose a category';
  if (!form.description.trim()) errors.description = 'Description is required';
  if (!isValidAmount(form.amount)) errors.amount = 'Enter an amount of 0 or more, like 125.50';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expense_date)) errors.expense_date = 'Choose a date';
  return errors;
}

// ---------------------------------------------------------------------------
// Labor breakdown (comparison only, ADR 004). Values arrive from the server as exact strings; null means
// "not set" or "cannot be calculated" and is shown as N/A (UC-02 wording).
// ---------------------------------------------------------------------------
export interface LaborStage {
  hourly_rate: string | null;
  estimated_hours: string | null;
  actual_hours: string;
  labor_estimated: string | null;
  labor_actual: string | null;
}

export const NOT_AVAILABLE = 'N/A';

/** True when both values exist and the actual labor cost is strictly greater than the estimate. */
export function isOverEstimate(actual: string | null, estimate: string | null): boolean {
  if (actual === null || estimate === null) return false;
  return parseCents(actual) > parseCents(estimate);
}

/** Hours arrive as two-decimal strings ("12.50"); a missing value is N/A. */
export function hoursText(value: string | null): string {
  return value === null ? NOT_AVAILABLE : formatCents(parseCents(value));
}

/**
 * Hours and the Total / Subtotal label of the labor card's last row. Estimated hours add up only the stages
 * that have them; actual hours add every finished hour in the project, including hours with no stage. The row
 * is a "Subtotal" while any stage lacks a rate or estimated hours, because its dollar totals then leave that
 * stage out. Hours worked with no stage have no rate, so they never appear in the dollar totals.
 */
export function summarizeLabor(stages: LaborStage[], unstagedHours: string): { estimatedHours: string | null; actualHours: string; label: 'Total' | 'Subtotal' } {
  const est = stages.filter((s) => s.estimated_hours !== null).map((s) => s.estimated_hours as string);
  const complete = stages.every((s) => s.labor_estimated !== null && s.labor_actual !== null);
  return {
    estimatedHours: est.length ? sumAmounts(est) : null,
    actualHours: sumAmounts([...stages.map((s) => s.actual_hours), unstagedHours]),
    label: complete ? 'Total' : 'Subtotal',
  };
}

export interface LaborInput {
  hourly_rate: string | null;
  estimated_hours: string | null;
}

/** Reads the two inline-edit boxes. Empty clears the value (null); anything else must be 0 or more. */
export function parseLaborInput(rate: string, hours: string): { value: LaborInput; errors: { hourly_rate?: string; estimated_hours?: string } } {
  const errors: { hourly_rate?: string; estimated_hours?: string } = {};
  const read = (raw: string, key: 'hourly_rate' | 'estimated_hours', message: string): string | null => {
    if (raw.trim() === '') return null;
    if (!isValidAmount(raw)) {
      errors[key] = message;
      return null;
    }
    return normalizeAmount(raw);
  };
  const hourly_rate = read(rate, 'hourly_rate', 'Enter a rate of 0 or more, like 85.00');
  const estimated_hours = read(hours, 'estimated_hours', 'Enter hours of 0 or more, like 40');
  return { value: { hourly_rate, estimated_hours }, errors };
}
