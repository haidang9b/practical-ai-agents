import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api';
import HabitTrackerPage from './HabitTrackerPage';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const today = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
})();
const habit = {
  id: 'habit-1', name: 'Đọc sách', description: 'Hai mươi phút mỗi ngày', category: 'Học tập', icon: '📚', color: '#56846c',
  frequency: 'daily' as const, weeklyTarget: 1, startDate: today, endDate: '', archived: false,
  currentStreak: 2, longestStreak: 4, completionRate: 50, weeklyCompleted: 1, weeklyRemaining: 0,
};

const mockedApiRequest = vi.mocked(apiRequest);

describe('habit tracker page', () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    mockedApiRequest.mockImplementation(async <T,>(path: string, options: RequestInit = {}) => {
      if (path.startsWith('/habit-analytics/summary')) return { summary: { today, completedToday: 0, activeToday: 1, completionRate: 0, habits: [habit] } } as T;
      if (path.startsWith('/habit-analytics/history')) return { completions: [] } as T;
      if (path.includes('/completions/')) return { completed: options.method === 'PUT', date: today } as T;
      throw new Error(`Unexpected API path: ${path}`);
    });
  });

  it('loads habits and records a completion from the dashboard', async () => {
    const user = userEvent.setup();
    render(<HabitTrackerPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Đang tải thói quen');
    await screen.findByRole('heading', { name: 'Đọc sách' });
    expect(screen.getByText('0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hoàn thành: Đọc sách' }));

    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/habits/habit-1/completions/${today}\\?timeZone=`)),
      expect.objectContaining({ method: 'PUT' }),
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã ghi nhận tiến độ.');
  });

  it('shows an API loading error accessibly', async () => {
    mockedApiRequest.mockRejectedValue(new Error('Không thể tải thói quen.'));
    render(<HabitTrackerPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải thói quen.');
  });
});
