/**
 * @author Aashwat Singh
 * @description Plain-language summary of one run of the deadline-reminder job, shown after "Run deadline
 *   reminders" on the Notifications page: how many people were checked, how many new reminders were
 *   created and how many of those are for the signed-in person. Running it again says nothing is new.
 * @traces SE-FR-29, UC-22
 */
import type { ReminderRunResult } from '../../shared/types';

export function reminderSummary(result: ReminderRunResult): string {
  const people = `${result.users_checked} ${result.users_checked === 1 ? 'person' : 'people'}`;
  if (result.reminders_created === 0) return `Reminder job ran for ${people}: nothing new, every reminder already exists.`;
  const n = result.reminders_created;
  const mine = result.mine ? ` (${result.mine} for you)` : '';
  return `Reminder job created ${n} new reminder${n === 1 ? '' : 's'}${mine}.`;
}
