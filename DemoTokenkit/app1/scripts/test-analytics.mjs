import assert from 'node:assert/strict'
import { calculateFocusByDay, calculateOnTime, calculateStreaks, dateKeysBetween, isValidTimeZone, localDateKey, localDateStart, summarizeFocusByWeek } from '../server/analytics.js'

const tasks = [
  { completed_at: '2026-03-10T17:00:00.000Z', due_date: '2026-03-10', completed_due_date: '2026-03-10', completed: 1 },
  { completed_at: '2026-03-11T18:00:00.000Z', due_date: '2026-03-10', completed_due_date: '2026-03-10', completed: 1 },
  { completed_at: '2026-03-11T18:00:00.000Z', due_date: '', completed_due_date: '', completed: 1 },
  { completed_at: null, due_date: '2026-03-09', completed_due_date: '', completed: 0 },
  { completed_at: '2026-03-12T18:00:00.000Z', due_date: '2026-03-12', completed_due_date: '2026-03-12', completed: 1 },
]
assert.deepEqual(calculateOnTime(tasks, 'America/Los_Angeles', '2026-03-01', '2026-03-31', '2026-03-31'), {
  completedOnTime: 2,
  completedLate: 1,
  overdue: 1,
  eligible: 3,
  rate: 67,
})
assert.equal(calculateOnTime([], 'UTC', '2026-03-01', '2026-03-31', '2026-03-31').rate, null)
assert.equal(localDateKey('2026-03-10T06:30:00.000Z', 'America/Los_Angeles'), '2026-03-09')
assert.equal(isValidTimeZone('America/Los_Angeles'), true)
assert.equal(isValidTimeZone('Mars/Olympus'), false)
assert.deepEqual(dateKeysBetween('2026-03-07', '2026-03-09'), ['2026-03-07', '2026-03-08', '2026-03-09'])

const dstStart = new Date(localDateStart('2026-03-08', 'America/Los_Angeles')).getTime()
const nextDayStart = new Date(localDateStart('2026-03-09', 'America/Los_Angeles')).getTime()
assert.equal(nextDayStart - dstStart, 23 * 60 * 60 * 1000)
const dailyFocus = calculateFocusByDay([
  { started_at: '2026-03-08T07:30:00.000Z', ended_at: '2026-03-08T09:30:00.000Z' },
  { started_at: '2026-03-09T06:30:00.000Z', ended_at: '2026-03-09T07:30:00.000Z' },
], ['2026-03-08', '2026-03-09'], 'America/Los_Angeles')
assert.deepEqual(dailyFocus, [{ date: '2026-03-08', seconds: 7200 }, { date: '2026-03-09', seconds: 1800 }])
assert.deepEqual(summarizeFocusByWeek([
  { date: '2026-03-08', seconds: 3600 },
  { date: '2026-03-09', seconds: 1800 },
  { date: '2026-03-15', seconds: 600 },
]), [{ weekStart: '2026-03-02', seconds: 3600 }, { weekStart: '2026-03-09', seconds: 2400 }])

assert.deepEqual(calculateStreaks({ '2026-03-05': 1, '2026-03-06': 1, '2026-03-08': 2, '2026-03-09': 1, '2026-03-10': 20 }, '2026-03-09'), { current: 2, longest: 2 })
assert.deepEqual(calculateStreaks({ '2026-03-09': 1 }, '2026-03-09', 2), { current: 0, longest: 0 })
assert.deepEqual(calculateStreaks({ '2026-03-10': 5 }, '2026-03-09'), { current: 0, longest: 0 })
console.log('Analytics calculations passed: due-date snapshots, no due dates, late completions, local dates, DST, weekly focus, and streak boundaries.')