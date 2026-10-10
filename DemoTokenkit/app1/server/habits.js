export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function shiftDate(value, amount) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function weekStart(value) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

function eligibleDate(habit, date) {
  return date >= habit.startDate && (!habit.endDate || date <= habit.endDate)
}

function boundedEndDate(habit, today) {
  const archiveDate = habit.archivedAt?.slice(0, 10)
  return [today, habit.endDate, archiveDate].filter(Boolean).sort()[0]
}

export function calculateHabitStats(habit, completionDates, today) {
  const endDate = boundedEndDate(habit, today)
  const completions = [...new Set(completionDates.filter((date) => date <= endDate && eligibleDate(habit, date)))].sort()
  const completed = new Set(completions)

  if (habit.frequency === 'daily') {
    let currentDate = completed.has(endDate) ? endDate : shiftDate(endDate, -1)
    let current = 0
    while (currentDate >= habit.startDate && completed.has(currentDate)) {
      current += 1
      currentDate = shiftDate(currentDate, -1)
    }
    let longest = 0
    let streak = 0
    let previous = ''
    for (const date of completions) {
      streak = previous && shiftDate(previous, 1) === date ? streak + 1 : 1
      longest = Math.max(longest, streak)
      previous = date
    }
    const eligibleDays = Math.max(0, Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${habit.startDate}T00:00:00Z`)) / 86_400_000) + 1)
    return { currentStreak: current, longestStreak: longest, weeklyCount: completions.filter((date) => weekStart(date) === weekStart(endDate)).length, weeklyTarget: habit.weeklyTarget, completedCount: completions.length, eligibleCount: eligibleDays, completionRate: eligibleDays ? Math.round(completions.length / eligibleDays * 100) : 0 }
  }

  const countsByWeek = new Map()
  for (const date of completions) countsByWeek.set(weekStart(date), (countsByWeek.get(weekStart(date)) ?? 0) + 1)
  const firstWeek = weekStart(habit.startDate)
  const lastWeek = weekStart(endDate)
  const qualifyingWeeks = []
  for (let week = firstWeek; week <= lastWeek; week = shiftDate(week, 7)) {
    const count = countsByWeek.get(week) ?? 0
    if (count >= habit.weeklyTarget) qualifyingWeeks.push(week)
  }
  let longest = 0
  let streak = 0
  let previous = ''
  for (const week of qualifyingWeeks) {
    streak = previous && shiftDate(previous, 7) === week ? streak + 1 : 1
    longest = Math.max(longest, streak)
    previous = week
  }
  let currentWeek = weekStart(endDate)
  const currentWeekCount = countsByWeek.get(weekStart(endDate)) ?? 0
  if (currentWeek === weekStart(endDate) && currentWeekCount < habit.weeklyTarget) currentWeek = shiftDate(currentWeek, -7)
  let current = 0
  while (qualifyingWeeks.includes(currentWeek)) {
    current += 1
    currentWeek = shiftDate(currentWeek, -7)
  }
  const eligibleWeeks = Math.max(0, Math.floor((Date.parse(`${lastWeek}T00:00:00Z`) - Date.parse(`${firstWeek}T00:00:00Z`)) / (7 * 86_400_000)) + 1)
  return { currentStreak: current, longestStreak: longest, weeklyCount: currentWeekCount, weeklyTarget: habit.weeklyTarget, completedCount: completions.length, eligibleCount: eligibleWeeks * habit.weeklyTarget, completionRate: eligibleWeeks ? Math.min(100, Math.round(completions.length / (eligibleWeeks * habit.weeklyTarget) * 100)) : 0 }
}

export function dateKeysBetween(start, end) {
  const dates = []
  for (let date = start; date <= end; date = shiftDate(date, 1)) dates.push(date)
  return dates
}