import type { Task, TaskDraft } from '../types/task'
import type { Project, ProjectDraft, ProjectTemplate, Subtask } from '../types/project'

export interface SessionUser {
  id: string
  email: string
  displayName: string
}

export interface AuthSession {
  user: SessionUser
  accessToken: string
}

interface ApiOptions {
  token?: string
  method?: string
  body?: unknown
}

let refreshInFlight: Promise<AuthSession | null> | null = null

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(payload.error ?? 'Không thể kết nối với máy chủ.')
  return payload as T
}

export async function authenticate(mode: 'login' | 'register', values: { email: string; password: string; displayName?: string }): Promise<AuthSession> {
  const response = await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(values),
  })
  return readJson<AuthSession>(response)
}

export function restoreSession(): Promise<AuthSession | null> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() as Promise<AuthSession> : null)
      .catch(() => null)
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
}

export async function apiRequest<T>(
  path: string,
  token: string,
  options: ApiOptions = {},
  onTokenRefresh?: (token: string) => void,
): Promise<T> {
  const send = (accessToken: string) => fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  let response = await send(token)
  if (response.status === 401) {
    const session = await restoreSession()
    if (!session) {
      window.dispatchEvent(new Event('viec-nho:session-expired'))
      throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    }
    onTokenRefresh?.(session.accessToken)
    response = await send(session.accessToken)
  }
  if (response.status === 401) window.dispatchEvent(new Event('viec-nho:session-expired'))
  return readJson<T>(response)
}

export function getTasks(token: string, onTokenRefresh: (token: string) => void): Promise<{ tasks: Task[] }> {
  return apiRequest('/api/tasks', token, {}, onTokenRefresh)
}

export function createTask(token: string, draft: TaskDraft, onTokenRefresh: (token: string) => void): Promise<{ task: Task }> {
  return apiRequest('/api/tasks', token, { method: 'POST', body: draft }, onTokenRefresh)
}

export function updateTask(token: string, id: string, changes: Partial<Task>, onTokenRefresh: (token: string) => void): Promise<{ task: Task }> {
  return apiRequest(`/api/tasks/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: changes }, onTokenRefresh)
}

export function deleteTask(token: string, id: string, onTokenRefresh: (token: string) => void): Promise<void> {
  return apiRequest(`/api/tasks/${encodeURIComponent(id)}`, token, { method: 'DELETE' }, onTokenRefresh)
}

export function getProjects(token: string, onTokenRefresh: (token: string) => void): Promise<{ projects: Project[] }> {
  return apiRequest('/api/projects', token, {}, onTokenRefresh)
}

export function getProject(token: string, id: string, onTokenRefresh: (token: string) => void): Promise<{ project: Project; tasks: Task[] }> {
  return apiRequest(`/api/projects/${encodeURIComponent(id)}`, token, {}, onTokenRefresh)
}

export function createProject(token: string, draft: ProjectDraft, onTokenRefresh: (token: string) => void): Promise<{ project: Project }> {
  return apiRequest('/api/projects', token, { method: 'POST', body: draft }, onTokenRefresh)
}

export function updateProject(token: string, id: string, changes: Partial<ProjectDraft> & { archived?: boolean }, onTokenRefresh: (token: string) => void): Promise<{ project: Project }> {
  return apiRequest(`/api/projects/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: changes }, onTokenRefresh)
}

export function deleteProject(token: string, id: string, taskBehavior: 'unassign' | 'delete', onTokenRefresh: (token: string) => void): Promise<void> {
  return apiRequest(`/api/projects/${encodeURIComponent(id)}`, token, { method: 'DELETE', body: { taskBehavior } }, onTokenRefresh)
}

export function getProjectTemplates(token: string, onTokenRefresh: (token: string) => void): Promise<{ templates: ProjectTemplate[] }> {
  return apiRequest('/api/project-templates', token, {}, onTokenRefresh)
}

export function createProjectFromTemplate(token: string, values: { templateId: ProjectTemplate['id']; name?: string; description?: string; color?: string }, onTokenRefresh: (token: string) => void): Promise<{ project: Project }> {
  return apiRequest('/api/projects/from-template', token, { method: 'POST', body: values }, onTokenRefresh)
}

export function getSubtasks(token: string, taskId: string, onTokenRefresh: (token: string) => void): Promise<{ subtasks: Subtask[] }> {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/subtasks`, token, {}, onTokenRefresh)
}

export function createSubtask(token: string, taskId: string, title: string, onTokenRefresh: (token: string) => void): Promise<{ subtask: Subtask }> {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/subtasks`, token, { method: 'POST', body: { title } }, onTokenRefresh)
}

export function updateSubtask(token: string, taskId: string, subtaskId: string, changes: Partial<Pick<Subtask, 'title' | 'completed' | 'position'>>, onTokenRefresh: (token: string) => void): Promise<{ subtask: Subtask }> {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`, token, { method: 'PATCH', body: changes }, onTokenRefresh)
}

export function deleteSubtask(token: string, taskId: string, subtaskId: string, onTokenRefresh: (token: string) => void): Promise<void> {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`, token, { method: 'DELETE' }, onTokenRefresh)
}

export interface AnalyticsData {
  range: { startDate: string; endDate: string; timezone: string }
  totals: { created: number; completed: number; remaining: number; comparison: { created: number; completed: number } }
  completion: { date: string; count: number }[]
  onTime: { completedOnTime: number; completedLate: number; overdue: number; eligible: number; rate: number | null }
  focus: { totalSeconds: number; daily: { date: string; seconds: number }[]; weekly: { weekStart: string; seconds: number }[]; previousPeriodSeconds: number }
  streak: { current: number; longest: number; dailyGoal: number; historyStart: string; activity: { date: string; count: number }[] }
  projects: { id: string; name: string; color: string; created: number; completed: number; remaining: number }[]
}

export interface FocusSession {
  id: string
  taskId: string | null
  projectId: string | null
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  plannedDurationSeconds: number
  status: 'running' | 'paused' | 'completed' | 'interrupted'
  accumulatedSeconds?: number
  activeSegmentStartedAt?: string | null
}

export interface Habit {
  id: string
  name: string
  description: string
  category: string
  icon: string
  color: string
  frequency: 'daily' | 'weekly'
  weeklyTarget: number
  startDate: string
  endDate: string | null
  archived: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type HabitDraft = Pick<Habit, 'name' | 'description' | 'category' | 'icon' | 'color' | 'frequency' | 'weeklyTarget' | 'startDate' | 'endDate'>

export interface HabitProgress extends Habit {
  currentStreak: number
  longestStreak: number
  weeklyCount: number
  completedCount: number
  eligibleCount: number
  completionRate: number
  todayCompleted: boolean
  eligibleToday: boolean
  weekCompletions: number
  monthCompletions: number
}

export interface HabitSummary {
  date: string
  today: { total: number; completed: number; rate: number }
  week: { startDate: string; completed: number; target: number }
  month: { completed: number; target: number; rate: number }
  habits: HabitProgress[]
  activeCount: number
  eligibleToday: number
  weeklyExpected: number
}

export interface HabitHistoryDay {
  date: string
  count: number
  eligibleDaily: number
  missedDaily: number
  completions: { habitId: string; name: string; category: string; color: string }[]
}

export function getHabits(token: string, archived: boolean | 'all', onTokenRefresh: (token: string) => void): Promise<{ habits: Habit[] }> {
  return apiRequest(`/api/habits?archived=${archived}`, token, {}, onTokenRefresh)
}

export function createHabit(token: string, draft: HabitDraft, onTokenRefresh: (token: string) => void): Promise<{ habit: Habit }> {
  return apiRequest('/api/habits', token, { method: 'POST', body: draft }, onTokenRefresh)
}

export function updateHabit(token: string, id: string, changes: Partial<HabitDraft> & { archived?: boolean }, onTokenRefresh: (token: string) => void): Promise<{ habit: Habit }> {
  return apiRequest(`/api/habits/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: changes }, onTokenRefresh)
}

export function archiveHabit(token: string, id: string, onTokenRefresh: (token: string) => void): Promise<{ habit: Habit }> {
  return apiRequest(`/api/habits/${encodeURIComponent(id)}/archive`, token, { method: 'POST' }, onTokenRefresh)
}

export function deleteHabit(token: string, id: string, onTokenRefresh: (token: string) => void): Promise<void> {
  return apiRequest(`/api/habits/${encodeURIComponent(id)}`, token, { method: 'DELETE' }, onTokenRefresh)
}

export function getHabitSummary(token: string, timezone: string, onTokenRefresh: (token: string) => void): Promise<HabitSummary> {
  return apiRequest(`/api/habit-analytics/summary?${new URLSearchParams({ timezone })}`, token, {}, onTokenRefresh)
}

export function getHabitHistory(token: string, startDate: string, endDate: string, timezone: string, onTokenRefresh: (token: string) => void): Promise<{ startDate: string; endDate: string; days: HabitHistoryDay[] }> {
  const query = new URLSearchParams({ startDate, endDate, timezone })
  return apiRequest(`/api/habit-analytics/history?${query}`, token, {}, onTokenRefresh)
}

export async function setHabitCompletion(token: string, habitId: string, date: string, completed: boolean, timezone: string, onTokenRefresh: (token: string) => void): Promise<void> {
  const path = `/api/habits/${encodeURIComponent(habitId)}/completions/${encodeURIComponent(date)}?${new URLSearchParams({ timezone })}`
  if (completed) await apiRequest(path, token, { method: 'PUT' }, onTokenRefresh)
  else await apiRequest(path, token, { method: 'DELETE' }, onTokenRefresh)
}

export function getAnalytics(token: string, filters: { startDate: string; endDate: string; timezone: string; projectId?: string; dailyGoal: number }, onTokenRefresh: (token: string) => void): Promise<AnalyticsData> {
  const query = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate, timezone: filters.timezone, dailyGoal: String(filters.dailyGoal), ...(filters.projectId ? { projectId: filters.projectId } : {}) })
  return apiRequest(`/api/analytics?${query}`, token, {}, onTokenRefresh)
}

export function getActiveFocusSession(token: string, onTokenRefresh: (token: string) => void): Promise<{ session: FocusSession | null }> {
  return apiRequest('/api/focus-sessions/active', token, {}, onTokenRefresh)
}

export function startFocusSession(token: string, values: { durationSeconds: number; taskId?: string | null; projectId?: string | null }, onTokenRefresh: (token: string) => void): Promise<{ session: FocusSession }> {
  return apiRequest('/api/focus-sessions', token, { method: 'POST', body: values }, onTokenRefresh)
}

export function updateFocusSession(token: string, id: string, action: 'pause' | 'resume' | 'complete' | 'interrupt', onTokenRefresh: (token: string) => void): Promise<{ session: FocusSession; duplicate?: boolean }> {
  return apiRequest(`/api/focus-sessions/${encodeURIComponent(id)}/${action}`, token, { method: 'POST' }, onTokenRefresh)
}