import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { TASKS_KEY } from './lib/taskStorage';

describe('task manager', () => {
  it('creates a task and persists it locally', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /thêm công việc/i }));
    await user.type(screen.getByLabelText(/tên công việc/i), 'Gọi cho mẹ');
    await user.clear(screen.getByLabelText('Nhóm'));
    await user.type(screen.getByLabelText('Nhóm'), 'Gia đình');
    await user.click(screen.getByRole('button', { name: /tạo công việc/i }));

    expect(screen.getByRole('button', { name: 'Gọi cho mẹ' })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(TASKS_KEY) ?? '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Gọi cho mẹ', category: 'Gia đình', completed: false }),
    ])));
  });

  it('marks a task complete and updates the dashboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    const task = screen.getByRole('button', { name: 'Gửi bản đề xuất cho nhóm thiết kế' }).closest('.task-row');
    expect(task).not.toBeNull();

    await user.click(within(task as HTMLElement).getByRole('button', { name: /hoàn thành:/i }));

    expect(within(task as HTMLElement).getByRole('button', { name: /đánh dấu chưa xong:/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Hoàn thành 67%')).toBeInTheDocument();
  });
});