/**
 * @author Jon Sorey
 * @description Unit tests for exact cent math and the Total / Subtotal label.
 * @traces SE-NFR-01, SE-FR-02, SE-FR-04, UC-01
 */
import { describe, expect, it } from 'vitest';
import { calculateStageCostSummary, formatCents, hoursText, isOverEstimate, normalizeAmount, parseCents, parseLaborInput, subtractAmounts, summarizeLabor, sumAmounts, validateExpense, type LaborStage } from './model';

describe('UC-01 / SE-NFR-01 cost model', () => {
  it('adds money exactly (0.10 + 0.20 = 0.30, not 0.30000000000000004)', () => {
    expect(sumAmounts(['0.10', '0.20'])).toBe('0.30');
  });
  it('rounds half-up to the cent', () => {
    expect(normalizeAmount('10.005')).toBe('10.01');
    expect(normalizeAmount('10.004')).toBe('10.00');
    expect(parseCents('1234.565')).toBe(123457n);
    expect(formatCents(5n)).toBe('0.05');
  });
  it('labels a partial selection as Subtotal and a full one as Total', () => {
    const stages = [{ amount: '4250.00' }, { amount: '6800.50' }, { amount: '18400.25' }, { amount: '5120.10' }, { amount: '2300.00' }];
    expect(calculateStageCostSummary(stages, false)).toEqual({ sum: '36870.85', label: 'Total' });
    expect(calculateStageCostSummary(stages.slice(0, 2), true)).toEqual({ sum: '11050.50', label: 'Subtotal' });
  });
  it('rejects negative or malformed amounts', () => {
    expect(() => parseCents('-1')).toThrow();
    expect(validateExpense({ category: 'other', description: 'x', amount: '-5', expense_date: '2026-01-01' }).amount).toBeTruthy();
    expect(validateExpense({ category: 'snacks', description: '', amount: '5', expense_date: '' })).toHaveProperty('category');
  });
  it('subtracts exactly', () => {
    expect(subtractAmounts('42000.00', '36870.85')).toBe('5129.15');
  });
});

const stage = (over: Partial<LaborStage> = {}): LaborStage => ({
  hourly_rate: '85.00', estimated_hours: '6.00', actual_hours: '6.75', labor_estimated: '510.00', labor_actual: '573.75', ...over,
});

describe('UC-01 / SE-NFR-01 labor breakdown (comparison only)', () => {
  it('flags actual labor above the estimate, never equal, and never when a side is N/A', () => {
    expect(isOverEstimate('573.75', '510.00')).toBe(true);
    expect(isOverEstimate('510.00', '510.00')).toBe(false);
    expect(isOverEstimate('509.99', '510.00')).toBe(false);
    expect(isOverEstimate(null, '510.00')).toBe(false);
    expect(isOverEstimate('573.75', null)).toBe(false);
  });
  it('shows a missing value as N/A and exact two-decimal hours otherwise', () => {
    expect(hoursText(null)).toBe('N/A');
    expect(hoursText('6')).toBe('6.00');
    expect(hoursText('0.1')).toBe('0.10');
  });
  it('adds hours exactly, includes unstaged hours in the actual total, and labels a partial row Subtotal', () => {
    const all = summarizeLabor([stage(), stage({ estimated_hours: '60.00', actual_hours: '9.50', labor_estimated: '5400.00', labor_actual: '855.00' })], '2.00');
    expect(all).toEqual({ estimatedHours: '66.00', actualHours: '18.25', label: 'Total' });
    const partial = summarizeLabor([stage(), stage({ hourly_rate: null, labor_estimated: null, labor_actual: null, estimated_hours: null })], '0.00');
    expect(partial.label).toBe('Subtotal');
    expect(partial.estimatedHours).toBe('6.00');
    expect(summarizeLabor([stage({ estimated_hours: null, labor_estimated: null })], '0.10').estimatedHours).toBeNull();
    expect(summarizeLabor([0.1, 0.2].map((h) => stage({ actual_hours: h.toFixed(2) })), '0.00').actualHours).toBe('0.30');
  });
  it('parses the inline rate and hours boxes: empty clears, bad input is an error, values round half-up', () => {
    expect(parseLaborInput('10.005', '0.5')).toEqual({ value: { hourly_rate: '10.01', estimated_hours: '0.50' }, errors: {} });
    expect(parseLaborInput('', '  ').value).toEqual({ hourly_rate: null, estimated_hours: null });
    const bad = parseLaborInput('-5', 'abc');
    expect(Object.keys(bad.errors).sort()).toEqual(['estimated_hours', 'hourly_rate']);
  });
});
