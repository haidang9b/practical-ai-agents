import { describe, expect, it } from 'vitest';
import { habitStatistics, type HabitRecord } from './habits';

function habit(overrides: Partial<HabitRecord> = {}): HabitRecord {
  return {
    id: 'habit-1', name: 'Read', description: '', category: 'Learning', icon: '📚', color: '#56846c',
    frequency: 'daily', weekly_target: 1, start_date: '2026-04-01', end_date: '', archived: 0,
    ...overrides,
  };
}

describe('habit statistics', () => {
  it('calculates daily streaks, ignores future records, and respects the active date range', () => {
    const result = habitStatistics(habit({ end_date: '2026-04-06' }), [
      '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-04', '2026-04-05', '2026-04-06', '2026-04-07',
    ], '2026-04-06');

    expect(result).toEqual({ currentStreak: 3, longestStreak: 3, completionRate: 83, weeklyCompleted: 1, weeklyTarget: 7, weeklyRemaining: 6 });
  });

  it('keeps a daily streak alive through today when only yesterday is complete', () => {
    const result = habitStatistics(habit(), ['2026-04-04', '2026-04-05'], '2026-04-06');
    expect(result.currentStreak).toBe(2);
  });

  it('counts weekly target streaks by qualifying calendar weeks, not consecutive days', () => {
    const result = habitStatistics(habit({ frequency: 'weekly', weekly_target: 2, start_date: '2026-03-23' }), [
      '2026-03-23', '2026-03-25', '2026-03-30', '2026-04-01', '2026-04-08', '2026-04-09',
    ], '2026-04-08');

    expect(result).toEqual({ currentStreak: 2, longestStreak: 2, completionRate: 67, weeklyCompleted: 1, weeklyTarget: 2, weeklyRemaining: 1 });
  });
});
