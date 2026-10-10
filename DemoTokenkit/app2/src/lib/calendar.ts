import type { Task } from '../types';

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!dayPattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function calendarDateForTask(task: Task): string {
  const scheduledDay = task.scheduledAt?.slice(0, 10) ?? '';
  if (isCalendarDate(scheduledDay)) return scheduledDay;
  return isCalendarDate(task.dueDate) ? task.dueDate : '';
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftDate(date: Date, amount: number): Date {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

export function startOfWeek(date: Date): Date {
  return shiftDate(date, -((date.getDay() + 6) % 7));
}

export function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
}

export function getMonthDays(date: Date): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const endOffset = (7 - ((last.getDay() + 6) % 7) - 1) % 7;
  const end = shiftDate(last, endOffset);
  return Array.from({ length: Math.round((end.getTime() - start.getTime()) / 86400000) + 1 }, (_, index) => shiftDate(start, index));
}

export function moveTaskToDate(task: Task, targetDate: string): Task {
  if (!isCalendarDate(targetDate)) return task;
  const existingTime = task.scheduledAt?.match(/^\d{4}-\d{2}-\d{2}(T.*)$/)?.[1] ?? '';
  return { ...task, scheduledAt: `${targetDate}${existingTime}` };
}

export function getWeekStatistics(tasks: Task[], days: Date[], today: string) {
  const weekKeys = new Set(days.map(formatDateKey));
  const weekTasks = tasks.filter((task) => weekKeys.has(calendarDateForTask(task)));
  return {
    completed: weekTasks.filter((task) => task.completed).length,
    remaining: weekTasks.filter((task) => !task.completed).length,
    overdue: weekTasks.filter((task) => !task.completed && isCalendarDate(task.dueDate) && task.dueDate < today).length,
  };
}