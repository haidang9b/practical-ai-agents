import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { calendarDateForTask, getMonthDays, getWeekDays, getWeekStatistics, moveTaskToDate } from './calendar';

const task: Task = {
  id: 'task-1',
  title: 'Prepare report',
  description: 'Keep the notes',
  category: 'Work',
  priority: 'high',
  dueDate: '2026-10-09',
  scheduledAt: '2026-10-08T09:30',
  status: 'todo',
  completed: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  project: 'Work',
  tags: [],
};

describe('calendar date helpers', () => {
  it('uses a planned date for placement without changing the deadline', () => {
    expect(calendarDateForTask(task)).toBe('2026-10-08');
    expect(moveTaskToDate(task, '2026-10-10')).toEqual({ ...task, scheduledAt: '2026-10-10T09:30' });
  });

  it('falls back to a valid deadline and omits malformed dates', () => {
    expect(calendarDateForTask({ ...task, scheduledAt: '', dueDate: '2026-10-09' })).toBe('2026-10-09');
    expect(calendarDateForTask({ ...task, scheduledAt: 'not-a-date', dueDate: '2026-02-30' })).toBe('');
  });

  it('builds Monday-first navigation ranges and weekly counts', () => {
    const days = getWeekDays(new Date(2026, 9, 8));
    expect(days.map((date) => date.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(getMonthDays(new Date(2026, 9, 8)).length).toBe(35);
    expect(getWeekStatistics([task, { ...task, id: 'task-2', completed: true }], days, '2026-10-10')).toEqual({
      completed: 1,
      remaining: 1,
      overdue: 1,
    });
  });
});