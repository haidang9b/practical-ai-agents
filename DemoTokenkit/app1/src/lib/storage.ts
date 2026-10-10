import type { Task } from '../types/task'

const TASKS_KEY = 'viec-nho.tasks.v1'
const THEME_KEY = 'viec-nho.theme.v1'

export function readTasks(): Task[] {
  try {
    const value = localStorage.getItem(TASKS_KEY)
    return value ? (JSON.parse(value) as Task[]) : []
  } catch {
    return []
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
}

export function readTheme(): boolean {
  return localStorage.getItem(THEME_KEY) === 'dark'
}

export function saveTheme(isDark: boolean): void {
  localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light')
}