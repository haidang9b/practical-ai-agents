export interface HabitRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  frequency: 'daily' | 'weekly';
  weekly_target: number;
  start_date: string;
  end_date: string;
  archived: number;
}

export interface HabitStatistics {
  currentStreak: number;
  longestStreak: number;
  completionRate: number;
  weeklyCompleted: number;
  weeklyTarget: number;
  weeklyRemaining: number;
}

export function dateKeyOffset(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function mondayForDate(value: string): string {
  const weekday = new Date(`${value}T12:00:00.000Z`).getUTCDay();
  return dateKeyOffset(value, -((weekday + 6) % 7));
}

/**
 * Completion dates are local calendar keys supplied with the user's IANA timezone.
 * Daily streaks use consecutive dates; weekly streaks use consecutive Monday-based
 * weeks that meet their target. An unfinished current week is not a streak week.
 * Future and out-of-range records are ignored; archival preserves history but does
 * not make a habit active in today's denominator.
 */
export function habitStatistics(habit: HabitRecord, completionDates: string[], today: string): HabitStatistics {
  const eligibleDates = [...new Set(completionDates)].filter((date) =>
    date >= habit.start_date && (!habit.end_date || date <= habit.end_date) && date <= today,
  ).sort();
  const completed = new Set(eligibleDates);
  const thisWeek = mondayForDate(today);
  const weeklyTarget = habit.frequency === 'daily' ? 7 : habit.weekly_target;
  const currentWeekCount = eligibleDates.filter((date) => mondayForDate(date) === thisWeek).length;
  const weeklyCompleted = Math.min(currentWeekCount, weeklyTarget);
  const currentStreakAnchor = habit.frequency === 'daily'
    ? (completed.has(today) ? today : dateKeyOffset(today, -1))
    : (currentWeekCount >= weeklyTarget ? thisWeek : dateKeyOffset(thisWeek, -7));

  let currentStreak = 0;
  if (habit.frequency === 'daily') {
    for (let cursor = currentStreakAnchor; cursor >= habit.start_date && completed.has(cursor); cursor = dateKeyOffset(cursor, -1)) currentStreak += 1;
  } else {
    for (let cursor = currentStreakAnchor; cursor >= mondayForDate(habit.start_date); cursor = dateKeyOffset(cursor, -7)) {
      const count = eligibleDates.filter((date) => mondayForDate(date) === cursor).length;
      if (count < weeklyTarget) break;
      currentStreak += 1;
    }
  }

  let longestStreak = 0;
  let runningStreak = 0;
  if (habit.frequency === 'daily') {
    let previous = '';
    for (const date of eligibleDates) {
      runningStreak = previous && dateKeyOffset(previous, 1) === date ? runningStreak + 1 : 1;
      longestStreak = Math.max(longestStreak, runningStreak);
      previous = date;
    }
  } else {
    const qualifyingWeeks = new Set<string>();
    for (const date of eligibleDates) {
      const week = mondayForDate(date);
      if (eligibleDates.filter((candidate) => mondayForDate(candidate) === week).length >= weeklyTarget) qualifyingWeeks.add(week);
    }
    let previous = '';
    for (const week of [...qualifyingWeeks].sort()) {
      runningStreak = previous && dateKeyOffset(previous, 7) === week ? runningStreak + 1 : 1;
      longestStreak = Math.max(longestStreak, runningStreak);
      previous = week;
    }
  }

  const activeFrom = habit.start_date;
  const activeThrough = habit.end_date && habit.end_date < today ? habit.end_date : today;
  let completionRate = 0;
  if (activeFrom <= activeThrough) {
    if (habit.frequency === 'daily') {
      const eligibleCount = Math.floor((Date.parse(`${activeThrough}T12:00:00.000Z`) - Date.parse(`${activeFrom}T12:00:00.000Z`)) / 86400000) + 1;
      completionRate = Math.round((eligibleDates.length / eligibleCount) * 100);
    } else {
      const firstWeek = mondayForDate(activeFrom);
      const lastWeek = mondayForDate(activeThrough);
      const eligibleWeeks = Math.floor((Date.parse(`${lastWeek}T12:00:00.000Z`) - Date.parse(`${firstWeek}T12:00:00.000Z`)) / (7 * 86400000)) + 1;
      const completedWeeks = [...new Set(eligibleDates.map(mondayForDate))]
        .filter((week) => eligibleDates.filter((date) => mondayForDate(date) === week).length >= weeklyTarget).length;
      completionRate = Math.round((completedWeeks / eligibleWeeks) * 100);
    }
  }

  return { currentStreak, longestStreak, completionRate, weeklyCompleted, weeklyTarget, weeklyRemaining: Math.max(0, weeklyTarget - weeklyCompleted) };
}
