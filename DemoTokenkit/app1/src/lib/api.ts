import type { Task, TaskDraft } from '../types/task'

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