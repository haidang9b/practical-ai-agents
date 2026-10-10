import { API_BASE_URL } from './api';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

let restoreInFlight: Promise<AuthSession> | null = null;

interface AuthResponse extends AuthSession {
  error?: string;
}

async function authRequest(path: string, options: RequestInit = {}): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => ({})) as AuthResponse;
  if (!response.ok) throw new Error(body.error ?? 'Không thể kết nối. Vui lòng thử lại.');
  return { accessToken: body.accessToken, user: body.user };
}

export function signIn(email: string, password: string): Promise<AuthSession> {
  return authRequest('login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function signUp(email: string, password: string): Promise<AuthSession> {
  return authRequest('register', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function refreshSession(): Promise<AuthSession> {
  return authRequest('refresh', { method: 'POST' });
}

export function restoreSession(): Promise<AuthSession> {
  if (!restoreInFlight) {
    restoreInFlight = refreshSession().finally(() => { restoreInFlight = null; });
  }
  return restoreInFlight;
}

export async function signOut(): Promise<void> {
  await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
}