const dateFormatterCache = new Map()

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
    return true
  } catch {
    return false
  }
}

export function localDateKey(value, timeZone = 'UTC') {
  let formatter = dateFormatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dateFormatterCache.set(timeZone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function dateKeysBetween(startDate, endDate) {
  const cursor = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  const dates = []
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function localDateStart(dateKey, timeZone) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const target = Date.UTC(year, month - 1, day)
  let instant = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant))
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second))
    instant += target - represented
  }
  return new Date(instant).toISOString()
}

export function calculateOnTime(tasks, timeZone, startDate, endDate, today) {
  const scoped = tasks.filter((task) => task.completed_at && (task.completed_due_date ?? task.due_date) && isWithinRange(task.completed_at, timeZone, startDate, endDate))
  const completedOnTime = scoped.filter((task) => localDateKey(task.completed_at, timeZone) <= (task.completed_due_date || task.due_date)).length
  const completedLate = scoped.length - completedOnTime
  const overdue = tasks.filter((task) => !task.completed && task.due_date && task.due_date < today).length
  return {
    completedOnTime,
    completedLate,
    overdue,
    eligible: scoped.length,
    rate: scoped.length ? Math.round((completedOnTime / scoped.length) * 100) : null,
  }
}

export function isWithinRange(timestamp, timeZone, startDate, endDate) {
  const dateKey = localDateKey(timestamp, timeZone)
  return dateKey >= startDate && dateKey <= endDate
}

export function calculateFocusByDay(segments, dates, timeZone) {
  return dates.map((date) => {
    const dayStart = new Date(localDateStart(date, timeZone)).getTime()
    const nextDate = new Date(`${date}T00:00:00.000Z`)
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const nextDay = nextDate.toISOString().slice(0, 10)
    const dayEnd = new Date(localDateStart(nextDay, timeZone)).getTime()
    const milliseconds = segments.reduce((total, segment) => {
      const start = new Date(segment.started_at).getTime()
      const end = new Date(segment.ended_at).getTime()
      return total + Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart))
    }, 0)
    return { date, seconds: Math.floor(milliseconds / 1000) }
  })
}

export function summarizeFocusByWeek(daily) {
  const weekly = new Map()
  for (const entry of daily) {
    const date = new Date(`${entry.date}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    const weekStart = date.toISOString().slice(0, 10)
    weekly.set(weekStart, (weekly.get(weekStart) ?? 0) + entry.seconds)
  }
  return [...weekly].map(([weekStart, seconds]) => ({ weekStart, seconds }))
}

export function calculateStreaks(activityCounts, today, dailyGoal = 1) {
  const dates = Object.keys(activityCounts).filter((date) => date <= today && activityCounts[date] >= dailyGoal).sort()
  const active = new Set(dates)
  let longest = 0
  let run = 0
  let previous
  for (const date of dates) {
    const current = new Date(`${date}T00:00:00.000Z`)
    const consecutive = previous && current.getTime() - previous.getTime() === 86_400_000
    run = consecutive ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = current
  }

  const yesterdayDate = new Date(`${today}T00:00:00.000Z`)
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1)
  const yesterday = yesterdayDate.toISOString().slice(0, 10)
  let cursor = active.has(today) ? today : yesterday
  let current = 0
  while (active.has(cursor)) {
    current += 1
    const previousDate = new Date(`${cursor}T00:00:00.000Z`)
    previousDate.setUTCDate(previousDate.getUTCDate() - 1)
    cursor = previousDate.toISOString().slice(0, 10)
  }
  return { current, longest }
}
