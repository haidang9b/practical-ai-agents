import assert from 'node:assert/strict'
import { calculateHabitStats, isCalendarDate, weekStart } from '../server/habits.js'

const dailyHabit = { startDate: '2026-01-01', endDate: null, archivedAt: null, frequency: 'daily', weeklyTarget: 7 }
const weeklyHabit = { startDate: '2026-04-01', endDate: null, archivedAt: null, frequency: 'weekly', weeklyTarget: 3 }

assert.equal(isCalendarDate('2026-02-28'), true)
assert.equal(isCalendarDate('2026-02-30'), false)
assert.equal(isCalendarDate('2026-2-03'), false)

const daily = calculateHabitStats(dailyHabit, ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-05', '2026-05-06'], '2026-05-07')
assert.equal(daily.currentStreak, 2)
assert.equal(daily.longestStreak, 3)

const missedDaily = calculateHabitStats(dailyHabit, ['2026-05-05', '2026-05-07', '2026-05-08'], '2026-05-07')
assert.equal(missedDaily.currentStreak, 1)
assert.equal(missedDaily.longestStreak, 1)
assert.equal(missedDaily.completedCount, 2)

assert.equal(weekStart('2026-05-13'), '2026-05-11')
const weekly = calculateHabitStats(weeklyHabit, [
  '2026-04-27', '2026-04-28', '2026-04-29',
  '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-05-12',
], '2026-05-13')
assert.equal(weekly.currentStreak, 2)
assert.equal(weekly.longestStreak, 2)
assert.equal(weekly.weeklyCount, 1)

const archived = calculateHabitStats({ ...dailyHabit, startDate: '2026-05-02', endDate: '2026-05-05', archivedAt: '2026-05-04T12:00:00.000Z' }, [
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
], '2026-05-10')
assert.equal(archived.currentStreak, 3)
assert.equal(archived.completedCount, 3)
assert.equal(archived.eligibleCount, 3)
assert.equal(archived.completionRate, 100)

console.log('Habit calculations passed: date validation, daily streaks, weekly goals, archived bounds, and future-date exclusion.')