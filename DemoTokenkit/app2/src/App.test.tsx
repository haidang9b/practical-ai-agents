import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TodoWorkspace } from './App';
import { loadTasks, taskStorageKey } from './lib/taskStorage';
import type { Task } from './types';

function calendarTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'calendar-task',
    title: 'Review launch plan',
    description: 'Keep the original notes',
    category: 'Work',
    priority: 'high',
    dueDate: '2026-10-01',
    scheduledAt: new Date().toISOString().slice(0, 10),
    completed: false,
    createdAt: '2026-09-20T09:00:00.000Z',
    project: 'Work',
    tags: [],
    ...overrides,
    status: overrides.status ?? (overrides.completed ? 'done' : 'todo'),
  };
}

describe('task manager', () => {
  it('creates a task and persists it locally', async () => {
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: 'test-user', email: 'test@example.com' }} onLogout={() => {}} />);

    await user.click(screen.getByRole('button', { name: /thêm công việc/i }));
    await user.type(screen.getByLabelText(/tên công việc/i), 'Gọi cho mẹ');
    await user.clear(screen.getByLabelText('Nhóm'));
    await user.type(screen.getByLabelText('Nhóm'), 'Gia đình');
    await user.clear(screen.getByLabelText('Dự án'));
    await user.type(screen.getByLabelText('Dự án'), 'Gia đình');
    await user.type(screen.getByLabelText(/Thẻ/), 'gọi điện, cá nhân');
    await user.click(screen.getByRole('button', { name: /^Tạo công việc$/i }));

    expect(screen.getByRole('button', { name: 'Gọi cho mẹ' })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(taskStorageKey('test-user')) ?? '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Gọi cho mẹ', category: 'Gia đình', completed: false, project: 'Gia đình', tags: ['gọi điện', 'cá nhân'] }),
    ])));
  });

  it('marks a task complete and updates the dashboard', async () => {
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: 'test-user', email: 'test@example.com' }} onLogout={() => {}} />);
    const task = screen.getByRole('button', { name: 'Gửi bản đề xuất cho nhóm thiết kế' }).closest('.task-row');
    expect(task).not.toBeNull();

    await user.click(within(task as HTMLElement).getByRole('button', { name: /hoàn thành:/i }));

    expect(within(task as HTMLElement).getByRole('button', { name: /đánh dấu chưa xong:/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Hoàn thành 67%')).toBeInTheDocument();
  });

  it('migrates older locally stored tasks without a planned date', () => {
    localStorage.setItem(taskStorageKey('legacy-user'), JSON.stringify([{
      id: 'legacy-task', title: 'Older task', description: '', category: 'Work', priority: 'low', dueDate: '', completed: false, createdAt: '2025-01-01T00:00:00.000Z',
    }]));

    expect(loadTasks('legacy-user')[0]).toMatchObject({ scheduledAt: '', status: 'todo', completed: false, project: 'Work', tags: [] });
    localStorage.setItem(taskStorageKey('legacy-user'), JSON.stringify([{ id: 'legacy-done', title: 'Old completed task', completed: true }]));
    expect(loadTasks('legacy-user')[0]).toMatchObject({ status: 'done', completed: true });
  });

  it('renders tasks in the three Kanban columns and shows each count', async () => {
    const owner = 'board-columns-user';
    localStorage.setItem(taskStorageKey(owner), JSON.stringify([
      calendarTask({ id: 'board-todo', title: 'Board todo' }),
      calendarTask({ id: 'board-progress', title: 'Board progress', status: 'in_progress' }),
      calendarTask({ id: 'board-done', title: 'Board done', status: 'done', completed: true }),
    ]));
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: owner, email: 'board@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Bảng Kanban' }));

    expect(screen.getByRole('heading', { name: 'Cần làm' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Đang thực hiện' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Đã xong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board todo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board done' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cần làm, 1 công việc' })).toBeInTheDocument();
  });

  it('moves tasks by keyboard-accessible status control and persists all metadata', async () => {
    const owner = 'board-keyboard-user';
    const task = calendarTask({ id: 'board-keyboard-task', project: 'Launch', tags: ['review', 'urgent'] });
    localStorage.setItem(taskStorageKey(owner), JSON.stringify([task]));
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: owner, email: 'board@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Bảng Kanban' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái: Review launch plan' }), 'in_progress');

    await waitFor(() => expect(JSON.parse(localStorage.getItem(taskStorageKey(owner)) ?? '[]')).toEqual([
      expect.objectContaining({ id: task.id, status: 'in_progress', completed: false, project: 'Launch', tags: ['review', 'urgent'], description: task.description, dueDate: task.dueDate }),
    ]));
    expect(screen.getByRole('region', { name: 'Đang thực hiện, 1 công việc' })).toBeInTheDocument();
  });

  it('moves a dragged task into a column and persists its done status', async () => {
    const owner = 'board-drag-user';
    const task = calendarTask({ id: 'board-drag-task' });
    localStorage.setItem(taskStorageKey(owner), JSON.stringify([task]));
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: owner, email: 'board@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Bảng Kanban' }));
    const data = new Map<string, string>();
    const transfer = { effectAllowed: 'move', setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? '' } as unknown as DataTransfer;
    const card = screen.getByRole('button', { name: 'Review launch plan' }).closest('.kanban-card');
    expect(card).not.toBeNull();
    fireEvent.dragStart(card as HTMLElement, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole('region', { name: 'Đã xong, 0 công việc' }), { dataTransfer: transfer });

    await waitFor(() => expect(JSON.parse(localStorage.getItem(taskStorageKey(owner)) ?? '[]')).toEqual([
      expect.objectContaining({ id: task.id, status: 'done', completed: true, project: task.project, tags: task.tags, description: task.description }),
    ]));
    expect(screen.getByRole('region', { name: 'Đã xong, 1 công việc' })).toBeInTheDocument();
  });

  it('combines project, tag, priority, and search filters and can clear them', async () => {
    const owner = 'board-filter-user';
    localStorage.setItem(taskStorageKey(owner), JSON.stringify([
      calendarTask({ id: 'filter-match', title: 'Prepare launch report', project: 'Launch', tags: ['review'], priority: 'high' }),
      calendarTask({ id: 'filter-wrong-project', title: 'Prepare other report', project: 'Other', tags: ['review'], priority: 'high' }),
      calendarTask({ id: 'filter-wrong-tag', title: 'Prepare another report', project: 'Launch', tags: ['draft'], priority: 'high' }),
    ]));
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: owner, email: 'board@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Bảng Kanban' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc dự án' }), 'Launch');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc thẻ' }), 'review');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc ưu tiên' }), 'high');
    await user.type(screen.getByPlaceholderText('Tìm theo tên hoặc mô tả...'), 'launch');

    expect(screen.getByRole('button', { name: 'Prepare launch report' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare other report' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare another report' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(screen.getByRole('button', { name: 'Prepare other report' })).toBeInTheDocument();
  });

  it('shows an empty-state message in every empty Kanban column', async () => {
    const owner = 'board-empty-user';
    localStorage.setItem(taskStorageKey(owner), '[]');
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: owner, email: 'board@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Bảng Kanban' }));
    expect(screen.getAllByText('Chưa có công việc')).toHaveLength(3);
  });

  it('filters overdue tasks without including completed work', async () => {
    const owner = 'board-due-filter-user';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = (date: Date) => `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
    localStorage.setItem(taskStorageKey(owner), JSON.stringify([
      calendarTask({ id: 'overdue-open', title: 'Overdue open', dueDate: dateKey(yesterday) }),
      calendarTask({ id: 'overdue-done', title: 'Overdue done', dueDate: dateKey(yesterday), completed: true }),
    ]));
    const user = userEvent.setup();
    render(<TodoWorkspace user={{ id: owner, email: 'board@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Bảng Kanban' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc hạn hoàn thành' }), 'overdue');

    expect(screen.getByRole('button', { name: 'Overdue open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overdue done' })).not.toBeInTheDocument();
  });

  it('creates a task from a calendar date and stores its planned date', async () => {
    const user = userEvent.setup();
    const owner = 'calendar-create-user';
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;
    render(<TodoWorkspace user={{ id: owner, email: 'calendar@example.com' }} onLogout={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Lịch & kế hoạch' }));
    await user.click(screen.getByRole('button', { name: `Tạo công việc ngày ${dateKey}` }));
    expect(screen.getByLabelText('Ngày lên lịch')).toHaveValue(dateKey);
    await user.type(screen.getByLabelText(/tên công việc/i), 'Calendar quick task');
    await user.click(screen.getByRole('button', { name: /^Tạo công việc$/i }));

    await waitFor(() => expect(JSON.parse(localStorage.getItem(taskStorageKey(owner)) ?? '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Calendar quick task', scheduledAt: dateKey }),
    ])));
  });

  it('reschedules a dragged task without changing its deadline or metadata', async () => {
    const user = userEvent.setup();
    const owner = 'calendar-move-user';
    const task = calendarTask();
    localStorage.setItem(taskStorageKey(owner), JSON.stringify([task]));
    render(<TodoWorkspace user={{ id: owner, email: 'calendar@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Lịch & kế hoạch' }));

    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (today.getDay() === 0 ? -1 : 1));
    const targetDate = `${target.getFullYear()}-${`${target.getMonth() + 1}`.padStart(2, '0')}-${`${target.getDate()}`.padStart(2, '0')}`;
    const transferData = new Map<string, string>();
    const transfer = {
      setData(format: string, value: string) { transferData.set(format, value); },
      getData(format: string) { return transferData.get(format) ?? ''; },
    } as unknown as DataTransfer;
    const taskButton = screen.getByRole('button', { name: 'Mở công việc: Review launch plan' });
    const taskCard = taskButton.closest('.calendar-task');
    const destination = screen.getByRole('button', { name: `Tạo công việc ngày ${targetDate}` }).closest('.calendar-cell');
    expect(taskCard).not.toBeNull();
    expect(destination).not.toBeNull();

    fireEvent.dragStart(taskCard as HTMLElement, { dataTransfer: transfer });
    fireEvent.drop(destination as HTMLElement, { dataTransfer: transfer });

    await waitFor(() => expect(JSON.parse(localStorage.getItem(taskStorageKey(owner)) ?? '[]')).toEqual([
      expect.objectContaining({
        id: task.id,
        scheduledAt: targetDate,
        dueDate: task.dueDate,
        description: task.description,
        category: task.category,
        priority: task.priority,
      }),
    ]));
  });

  it('filters calendar tasks by completion, category, and priority and navigates dates', async () => {
    const user = userEvent.setup();
    const owner = 'calendar-filter-user';
    localStorage.setItem(taskStorageKey(owner), JSON.stringify([
      calendarTask({ id: 'open-work', title: 'Open high work', category: 'Work', priority: 'high' }),
      calendarTask({ id: 'done-work', title: 'Done high work', category: 'Work', priority: 'high', completed: true }),
      calendarTask({ id: 'open-home', title: 'Open low home', category: 'Home', priority: 'low' }),
    ]));
    render(<TodoWorkspace user={{ id: owner, email: 'calendar@example.com' }} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Lịch & kế hoạch' }));
    const range = screen.getByText(/\d{1,2} [–-] \d{1,2}/);
    const currentRange = range.textContent;
    await user.click(screen.getByRole('button', { name: 'Khoảng sau' }));
    expect(range).not.toHaveTextContent(currentRange ?? '');
    await user.click(screen.getByRole('button', { name: 'Hôm nay' }));
    await user.click(screen.getByRole('button', { name: 'Tháng' }));
    expect(screen.getByRole('button', { name: 'Tháng' })).toHaveAttribute('aria-pressed', 'true');
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;
    await user.click(screen.getByRole('button', { name: `Chọn ngày ${todayKey}` }));
    expect(screen.getByRole('button', { name: 'Ngày' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Tuần' }));
    await user.selectOptions(screen.getByLabelText('Lọc trạng thái lịch'), 'open');
    expect(screen.getByRole('button', { name: 'Mở công việc: Open high work' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mở công việc: Done high work' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Lọc nhóm lịch'), 'Work');
    expect(screen.queryByRole('button', { name: 'Mở công việc: Open low home' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Lọc ưu tiên lịch'), 'high');
    expect(screen.getByRole('button', { name: 'Mở công việc: Open high work' })).toBeInTheDocument();
  });
});