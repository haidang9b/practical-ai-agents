export interface AnalyticsTask {
  id: string;
  projectId: string | null;
  projectName: string;
  dueDate: string;
  createdAt: string;
  completed: boolean;
  completedAt: string | null;
}

export interface AnalyticsFocusSession {
  projectId: string | null;
  projectName: string;
  endedAt: string;
  durationSeconds: number;
}

function partsForDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFromTimestamp(value: string, timeZone: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : partsForDate(date, timeZone);
}

function shiftDate(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let key = from; key <= to; key = shiftDate(key, 1)) keys.push(key);
  return keys;
}

function streakSummary(activity: Map<string, number>, today: string, goal: number) {
  const qualifyingDates = [...activity.entries()]
    .filter(([date, count]) => date <= today && count >= goal)
    .map(([date]) => date)
    .sort();
  const qualifying = new Set(qualifyingDates);
  let current = 0;
  let cursor = qualifying.has(today) ? today : shiftDate(today, -1);
  while (qualifying.has(cursor)) {
    current += 1;
    cursor = shiftDate(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous = '';
  for (const date of qualifyingDates) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  return { current, longest };
}

export function buildAnalytics(
  tasks: AnalyticsTask[],
  sessions: AnalyticsFocusSession[],
  options: { from: string; to: string; timeZone: string; dailyGoal: number; today: string },
) {
  const { from, to, timeZone, dailyGoal, today } = options;
  const keys = dateKeys(from, to);
  const dailyCompleted = new Map(keys.map((key) => [key, 0]));
  const activity = new Map<string, number>();
  const focusSeconds = new Map(keys.map((key) => [key, 0]));
  const projectStats = new Map<string, { projectId: string | null; name: string; completed: number; focusSeconds: number }>();
  let created = 0;
  let completed = 0;
  let remaining = 0;
  let completedWithDueDate = 0;
  let completedOnTime = 0;
  let completedLate = 0;
  let overdue = 0;

  for (const task of tasks) {
    const createdDate = dateFromTimestamp(task.createdAt, timeZone);
    if (createdDate >= from && createdDate <= to) {
      created += 1;
      if (!task.completed) remaining += 1;
    }
    if (!task.completed) {
      if (task.dueDate && task.dueDate < today) overdue += 1;
      continue;
    }
    if (!task.completedAt) continue;
    const completedDate = dateFromTimestamp(task.completedAt, timeZone);
    if (!completedDate || completedDate > today) continue;
    activity.set(completedDate, (activity.get(completedDate) ?? 0) + 1);
    if (completedDate < from || completedDate > to) continue;
    completed += 1;
    dailyCompleted.set(completedDate, (dailyCompleted.get(completedDate) ?? 0) + 1);
    const projectKey = task.projectId ?? 'unassigned';
    const project = projectStats.get(projectKey) ?? { projectId: task.projectId, name: task.projectName || 'Chưa phân loại', completed: 0, focusSeconds: 0 };
    project.completed += 1;
    projectStats.set(projectKey, project);
    if (task.dueDate) {
      completedWithDueDate += 1;
      if (completedDate <= task.dueDate) completedOnTime += 1;
      else completedLate += 1;
    }
  }

  for (const session of sessions) {
    if (!session.endedAt || session.durationSeconds <= 0) continue;
    const endedDate = dateFromTimestamp(session.endedAt, timeZone);
    if (endedDate < from || endedDate > to || endedDate > today) continue;
    focusSeconds.set(endedDate, (focusSeconds.get(endedDate) ?? 0) + session.durationSeconds);
    const projectKey = session.projectId ?? 'unassigned';
    const project = projectStats.get(projectKey) ?? { projectId: session.projectId, name: session.projectName || 'Chưa phân loại', completed: 0, focusSeconds: 0 };
    project.focusSeconds += session.durationSeconds;
    projectStats.set(projectKey, project);
  }

  const periodLength = keys.length;
  const previousFrom = shiftDate(from, -periodLength);
  const previousTo = shiftDate(from, -1);
  const activityFrom = shiftDate(today, -364);
  const previousCompleted = tasks.filter((task) => {
    if (!task.completed || !task.completedAt) return false;
    const date = dateFromTimestamp(task.completedAt, timeZone);
    return date >= previousFrom && date <= previousTo;
  }).length;

  return {
    range: { from, to, timeZone },
    totals: { created, completed, remaining, overdue },
    onTime: {
      completedOnTime,
      completedLate,
      overdue,
      eligible: completedWithDueDate,
      rate: completedWithDueDate ? Math.round((completedOnTime / completedWithDueDate) * 1000) / 10 : null,
    },
    comparison: { previousCompleted, change: previousCompleted ? Math.round(((completed - previousCompleted) / previousCompleted) * 1000) / 10 : null },
    daily: keys.map((date) => ({ date, completed: dailyCompleted.get(date) ?? 0, focusSeconds: focusSeconds.get(date) ?? 0 })),
    activityRange: { from: activityFrom, to: today },
    activity: [...activity.entries()].map(([date, count]) => ({ date, count })).filter((item) => item.date >= activityFrom && item.date <= today).sort((first, second) => first.date.localeCompare(second.date)),
    streak: { ...streakSummary(activity, today, dailyGoal), dailyGoal },
    projects: [...projectStats.values()].sort((first, second) => second.completed - first.completed || second.focusSeconds - first.focusSeconds),
    focusTotalSeconds: [...focusSeconds.values()].reduce((total, value) => total + value, 0),
  };
}