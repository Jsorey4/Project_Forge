/**
 * @author Aashwat Singh
 * @description Unit tests for the sentence shown after the deadline-reminder job is run on demand.
 * @traces SE-FR-29, UC-22
 */
import { describe, expect, it } from 'vitest';
import { reminderSummary } from './reminders';

describe('UC-22 reminder job summary', () => {
  it('says how many reminders were created and how many are for the person', () => {
    expect(reminderSummary({ scope: 'all', users_checked: 3, reminders_created: 4, mine: 2 })).toBe('Reminder job created 4 new reminders (2 for you).');
    expect(reminderSummary({ scope: 'all', users_checked: 3, reminders_created: 1, mine: 0 })).toBe('Reminder job created 1 new reminder.');
  });
  it('says nothing is new when everything already exists', () => {
    expect(reminderSummary({ scope: 'all', users_checked: 5, reminders_created: 0, mine: 0 })).toBe('Reminder job ran for 5 people: nothing new, every reminder already exists.');
    expect(reminderSummary({ scope: 'self', users_checked: 1, reminders_created: 0, mine: 0 })).toBe('Reminder job ran for 1 person: nothing new, every reminder already exists.');
  });
});
