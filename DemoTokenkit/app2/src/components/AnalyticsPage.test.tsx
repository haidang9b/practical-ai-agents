import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnalyticsPage from './AnalyticsPage';
import type { Project, Task } from '../types';

const apiRequestMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ apiRequest: apiRequestMock }));

const emptyAnalytics = {
  range: { from: '2026-01-01', to: '2026-01-14', timeZone: 'UTC' },
  activityRange: { from: '2025-01-15', to: '2026-01-14' },
  totals: { created: 0, completed: 0, remaining: 0, overdue: 0 },
  onTime: { completedOnTime: 0, completedLate: 0, overdue: 0, eligible: 0, rate: null },
  comparison: { previousCompleted: 0, change: null },
  daily: [],
  activity: [],
  streak: { current: 0, longest: 0, dailyGoal: 1 },
  projects: [],
  focusTotalSeconds: 0,
};

const projects: Project[] = [];
const tasks: Task[] = [];
const renderPage = () => render(<AnalyticsPage userId="analytics-user" projects={projects} tasks={tasks} />);

describe('analytics dashboard', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => path === '/focus-sessions/active'
      ? Promise.resolve({ session: null })
      : Promise.resolve({ analytics: emptyAnalytics }));
  });

  it('announces the loading state while analytics are being fetched', () => {
    apiRequestMock.mockImplementation((path: string) => path === '/focus-sessions/active'
      ? Promise.resolve({ session: null })
      : new Promise(() => {}));
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Đang tổng hợp nhịp làm việc');
  });

  it('shows meaningful empty states when there is no activity', async () => {
    renderPage();

    expect(await screen.findByText('Chưa có công việc hoàn thành trong khoảng này.')).toBeInTheDocument();
    expect(screen.getByText('Chưa có việc hoàn thành có ngày đến hạn để tính tỷ lệ.')).toBeInTheDocument();
    expect(screen.getByText('Chưa có ngày hoạt động trong 365 ngày gần đây.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Đồng hồ Pomodoro' })).toBeInTheDocument();
  });

  it('shows a retry action after a failed analytics request', async () => {
    apiRequestMock.mockImplementationOnce(() => Promise.reject(new Error('Máy chủ tạm thời không phản hồi.')));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Máy chủ tạm thời không phản hồi.');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
  });
});