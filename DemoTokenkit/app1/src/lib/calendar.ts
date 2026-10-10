import type { Task } from '../types/task'

export type CalendarView = 'day' | 'week' | 'month'
export type TaskStatusFilter = 'all' | 'active' | 'completed'

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function taskCalendarDate(task: Task): string | null {
  const scheduledDate = task.scheduledAt?.slice(0, 10)
  if (scheduledDate && isValidDateKey(scheduledDate)) return scheduledDate
  return isValidDateKey(task.dueDate) ? task.dueDate : null
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const offset = (result.getDay() + 6) % 7
  result.setDate(result.getDate() - offset)
  return result
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + amount)
  return result
}

export function getWeekDates(date: Date): Date[] {
  const monday = startOfWeek(date)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

export function getMonthDates(date: Date): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const gridStart = startOfWeek(first)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

export function shiftDate(date: Date, view: CalendarView, direction: number): Date {
  if (view === 'day') return addDays(date, direction)
  if (view === 'week') return addDays(date, direction * 7)
  return new Date(date.getFullYear(), date.getMonth() + direction, 1)
}

export function tasksOnDate(tasks: Task[], dateKey: string): Task[] {
  return tasks.filter((task) => taskCalendarDate(task) === dateKey)
}

export function getWeekSummary(tasks: Task[], weekDate: Date, todayKey: string) {
  const weekKeys = new Set(getWeekDates(weekDate).map(toDateKey))
  const weekTasks = tasks.filter((task) => {
    const date = taskCalendarDate(task)
    return date !== null && weekKeys.has(date)
  })
  return {
    completed: weekTasks.filter((task) => task.completed).length,
    remaining: weekTasks.filter((task) => !task.completed).length,
    overdue: weekTasks.filter((task) => !task.completed && isValidDateKey(task.dueDate) && task.dueDate < todayKey).length,
  }
}

export function formatMonthTitle(date: Date): string {
  return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(date)
}

export function formatDateLong(date: Date): string {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export function formatTime(scheduledAt?: string | null): string {
  const match = scheduledAt?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})$/)
  return match ? `${match[1]}:${match[2]}` : ''
}