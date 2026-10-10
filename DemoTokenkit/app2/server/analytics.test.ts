import { describe, expect, it } from 'vitest';
import { buildAnalytics, type AnalyticsTask } from './analytics';

const tasks: AnalyticsTask[] = [
  { id: 'on-time', projectId: 'project-a', projectName: 'Dự án A', dueDate: '2026-01-03', createdAt: '2026-01-02T12:00:00.000Z', completed: true, completedAt: '2026-01-03T16:59:00.000Z' },
  { id: 'late', projectId: 'project-a', projectName: 'Dự án A', dueDate: '2026-01-03', createdAt: '2026-01-03T12:00:00.000Z', completed: true, completedAt: '2026-01-03T17:00:00.000Z' },
  { id: 'no-due-date', projectId: null, projectName: '', dueDate: '', createdAt: '2026-01-04T12:00:00.000Z', completed: true, completedAt: '2026-01-04T03:00:00.000Z' },
  { id: 'reopened', projectId: null, projectName: '', dueDate: '2026-01-02', createdAt: '2026-01-04T12:00:00.000Z', completed: false, completedAt: null },
  { id: 'future', projectId: null, projectName: '', dueDate: '', createdAt: '2026-01-04T12:00:00.000Z', completed: true, completedAt: '2026-01-06T03:00:00.000Z' },
];

describe('productivity analytics', () => {
  it('counts completions by local date and excludes missing due dates from on-time rate', () => {
    const result = buildAnalytics(tasks, [], {
      from: '2026-01-01', to: '2026-01-05', timeZone: 'Asia/Ho_Chi_Minh', dailyGoal: 1, today: '2026-01-05',
    });

    expect(result.totals).toMatchObject({ created: 5, completed: 3, remaining: 1 });
    expect(result.onTime).toMatchObject({ completedOnTime: 1, completedLate: 1, eligible: 2, rate: 50 });
    expect(result.daily.filter((item) => item.completed)).toEqual([
      { date: '2026-01-03', completed: 1, focusSeconds: 0 },
      { date: '2026-01-04', completed: 2, focusSeconds: 0 },
    ]);
  });

  it('calculates local-date streaks without counting future activity and honors a daily goal', () => {
    const oneTaskGoal = buildAnalytics(tasks, [], {
      from: '2026-01-01', to: '2026-01-05', timeZone: 'Asia/Ho_Chi_Minh', dailyGoal: 1, today: '2026-01-05',
    });
    const twoTaskGoal = buildAnalytics(tasks, [], {
      from: '2026-01-01', to: '2026-01-05', timeZone: 'Asia/Ho_Chi_Minh', dailyGoal: 2, today: '2026-01-05',
    });

    expect(oneTaskGoal.streak).toMatchObject({ current: 2, longest: 2, dailyGoal: 1 });
    expect(twoTaskGoal.streak).toMatchObject({ current: 1, longest: 1, dailyGoal: 2 });
  });

  it('allocates a completed focus session to its local end date', () => {
    const result = buildAnalytics(tasks, [
      { projectId: 'project-a', projectName: 'Dự án A', endedAt: '2026-01-03T17:00:00.000Z', durationSeconds: 1500 },
    ], {
      from: '2026-01-03', to: '2026-01-04', timeZone: 'Asia/Ho_Chi_Minh', dailyGoal: 1, today: '2026-01-05',
    });

    expect(result.daily).toEqual([
      { date: '2026-01-03', completed: 1, focusSeconds: 0 },
      { date: '2026-01-04', completed: 2, focusSeconds: 1500 },
    ]);
    expect(result.focusTotalSeconds).toBe(1500);
    expect(result.projects[0]).toMatchObject({ projectId: 'project-a', completed: 2, focusSeconds: 1500 });
  });

  it('keeps both sides of a daylight-saving transition in the correct local day', () => {
    const result = buildAnalytics([
      { id: 'before-dst', projectId: null, projectName: '', dueDate: '', createdAt: '2026-03-08T06:00:00.000Z', completed: true, completedAt: '2026-03-08T06:59:00.000Z' },
      { id: 'after-dst', projectId: null, projectName: '', dueDate: '', createdAt: '2026-03-08T07:00:00.000Z', completed: true, completedAt: '2026-03-08T07:00:00.000Z' },
    ], [], { from: '2026-03-08', to: '2026-03-08', timeZone: 'America/New_York', dailyGoal: 1, today: '2026-03-08' });

    expect(result.daily).toEqual([{ date: '2026-03-08', completed: 2, focusSeconds: 0 }]);
    expect(result.streak).toMatchObject({ current: 1, longest: 1 });
  });
});