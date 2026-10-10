import { describe, expect, it } from 'vitest'
import {
  getMonthDates,
  getWeekDates,
  getWeekSummary,
  isValidDateKey,
  shiftDate,
  taskCalendarDate,
  tasksOnDate,
  toDateKey,
} from '../src/lib/calendar'
import type { Task } from '../src/types/task'

const task = (changes: Partial<Task> = {}): Task => ({
  id: 'task',
  title: 'Review notes',
  description: '',
  category: 'Công việc',
  priority: 'medium',
  dueDate: '',
  scheduledAt: null,
  status: 'todo',
  completed: false,
  project: '',
  tags: [],
  createdAt: '2026-04-15T08:00:00.000Z',
  ...changes,
})

describe('calendar date utilities', () => {
  it('uses scheduled placement before the deadline and safely ignores invalid dates', () => {
    expect(taskCalendarDate(task({ dueDate: '2026-04-16', scheduledAt: '2026-04-15T09:30' }))).toBe('2026-04-15')
    expect(taskCalendarDate(task({ dueDate: '2026-04-16' }))).toBe('2026-04-16')
    expect(taskCalendarDate(task({ dueDate: '2026-02-31', scheduledAt: 'bad-date' }))).toBeNull()
    expect(isValidDateKey('2024-02-29')).toBe(true)
    expect(isValidDateKey('2026-02-29')).toBe(false)
  })

  it('builds Monday-first weeks, six-row months, and navigates by view', () => {
    const date = new Date(2026, 3, 15)
    expect(getWeekDates(date).map(toDateKey)).toEqual([
      '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18', '2026-04-19',
    ])
    expect(getMonthDates(date)).toHaveLength(42)
    expect(toDateKey(shiftDate(date, 'day', 1))).toBe('2026-04-16')
    expect(toDateKey(shiftDate(date, 'week', -1))).toBe('2026-04-08')
    expect(toDateKey(shiftDate(date, 'month', 1))).toBe('2026-05-01')
  })

  it('places tasks on their calendar date and calculates weekly totals', () => {
    const tasks = [
      task({ id: 'active', scheduledAt: '2026-04-15', dueDate: '2026-04-14' }),
      task({ id: 'done', dueDate: '2026-04-16', completed: true }),
      task({ id: 'overdue', dueDate: '2026-04-12' }),
      task({ id: 'undated' }),
    ]
    expect(tasksOnDate(tasks, '2026-04-15').map((item) => item.id)).toEqual(['active'])
    expect(getWeekSummary(tasks, new Date(2026, 3, 15), '2026-04-15')).toEqual({ completed: 1, remaining: 1, overdue: 1 })
  })
})