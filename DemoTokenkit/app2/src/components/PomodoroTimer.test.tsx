import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PomodoroTimer from './PomodoroTimer';

const apiRequestMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ apiRequest: apiRequestMock }));

function session(status: 'running' | 'paused' | 'completed' | 'interrupted', activeStartedAt: string | null, durationSeconds = 0) {
  return {
    id: 'focus-session-1', taskId: null, projectId: null, startedAt: '2026-01-01T00:00:00.000Z', activeStartedAt,
    durationSeconds, expectedDurationSeconds: 60, status,
  };
}

describe('Pomodoro timer', () => {
  afterEach(() => vi.useRealTimers());

  it('pauses, resumes, and saves one completed server-timed session', async () => {
    apiRequestMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    apiRequestMock.mockImplementation((path: string) => {
      if (path === '/focus-sessions/active') return Promise.resolve({ session: null });
      if (path === '/focus-sessions') return Promise.resolve({ session: session('running', new Date().toISOString()) });
      if (path.endsWith('/pause')) return Promise.resolve({ session: session('paused', null) });
      if (path.endsWith('/resume')) return Promise.resolve({ session: session('running', new Date().toISOString()) });
      if (path.endsWith('/complete')) return Promise.resolve({ session: session('completed', null, 60) });
      return Promise.resolve({ session: session('interrupted', null) });
    });
    render(<PomodoroTimer userId="timer-user" tasks={[]} projects={[]} onCompleted={() => {}} />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tập trung' })); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Tạm dừng' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' })); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' })); await Promise.resolve(); });

    await act(async () => { vi.advanceTimersByTime(61_000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('Giờ nghỉ')).toBeInTheDocument();
    expect(apiRequestMock.mock.calls.filter(([path]) => String(path).endsWith('/complete'))).toHaveLength(1);
  });

  it('marks a reset running session as interrupted instead of completed', async () => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === '/focus-sessions/active') return Promise.resolve({ session: null });
      if (path === '/focus-sessions') return Promise.resolve({ session: session('running', new Date().toISOString()) });
      return Promise.resolve({ session: session('interrupted', null) });
    });
    render(<PomodoroTimer userId="timer-reset-user" tasks={[]} projects={[]} onCompleted={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tập trung' })); await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dừng và đặt lại đồng hồ' })); await Promise.resolve(); });

    expect(apiRequestMock).toHaveBeenCalledWith('/focus-sessions/focus-session-1/interrupt', { method: 'POST' });
    expect(apiRequestMock.mock.calls.some(([path]) => String(path).endsWith('/complete'))).toBe(false);
  });

  it('restores an active session from the server after remount', async () => {
    apiRequestMock.mockReset();
    const activeSession = session('running', new Date(Date.now() - 10_000).toISOString());
    apiRequestMock.mockResolvedValue({ session: activeSession });
    render(<PomodoroTimer userId="timer-restore-user" tasks={[]} projects={[]} onCompleted={() => {}} />);

    expect(await screen.findByText('Đang tập trung')).toBeInTheDocument();
    expect(screen.getByText('00:50')).toBeInTheDocument();
    expect(apiRequestMock).toHaveBeenCalledWith('/focus-sessions/active');
  });
});