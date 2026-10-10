import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectsPage from './ProjectsPage';
import SubtaskList from './SubtaskList';
import type { Project, ProjectTemplate, Subtask, Task } from '../types';

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock('../lib/api', () => ({ apiRequest: mockApiRequest }));

const templates: ProjectTemplate[] = [
  { id: 'study', name: 'Dự án học tập', description: 'Kế hoạch học tập', color: '#56846c', tasks: ['Mục tiêu', 'Lịch học'] },
  { id: 'work', name: 'Dự án công việc', description: 'Kế hoạch công việc', color: '#df634d', tasks: ['Mục tiêu', 'Yêu cầu', 'Triển khai'] },
  { id: 'personal', name: 'Dự án cá nhân', description: 'Kế hoạch riêng', color: '#c18a36', tasks: ['Mục tiêu'] },
];

const project: Project = {
  id: 'project-1', user_id: 'owner', name: 'Launch', description: 'Release checklist', color: '#df634d', archived: 0,
  created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z',
  total_count: 4, active_count: 2, completed_count: 2, overdue_count: 1,
};

const tasks: Task[] = [
  { id: 'task-1', title: 'Prepare release', description: '', category: 'Work', priority: 'high', dueDate: '', scheduledAt: '', status: 'done', completed: true, createdAt: '2026-10-01T10:00:00.000Z', project: 'Launch', projectId: 'project-1', tags: [] },
  { id: 'task-2', title: 'Review notes', description: '', category: 'Work', priority: 'medium', dueDate: '', scheduledAt: '', status: 'todo', completed: false, createdAt: '2026-10-02T10:00:00.000Z', project: 'Launch', projectId: 'project-1', tags: [] },
];

let subtasks: Subtask[];

beforeEach(() => {
  subtasks = [
    { id: 'sub-a', taskId: 'task-1', title: 'Draft', completed: false, position: 0, createdAt: '', updatedAt: '' },
    { id: 'sub-b', taskId: 'task-1', title: 'Review', completed: false, position: 1, createdAt: '', updatedAt: '' },
  ];
  mockApiRequest.mockReset();
  mockApiRequest.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === '/project-templates') return { templates };
    if (path === '/projects/project-1') return { project, tasks };
    if (path === '/tasks/task-1/subtasks') return { subtasks };
    if (path.startsWith('/tasks/task-1/subtasks/sub-') && options.method === 'PATCH') {
      const id = path.endsWith('sub-a') ? 'sub-a' : 'sub-b';
      const changes = JSON.parse(String(options.body)) as Partial<Subtask>;
      const index = subtasks.findIndex((item) => item.id === id);
      const subtask = { ...subtasks[index], ...changes };
      subtasks[index] = subtask;
      return { subtask };
    }
    return {};
  });
});

describe('project management', () => {
  it('shows persisted project task statistics and completion progress', async () => {
    const user = userEvent.setup();
    render(<ProjectsPage projects={[project]} onProjectsChange={() => {}} onEditTask={() => {}} />);

    expect(await screen.findByText('Launch')).toBeInTheDocument();
    expect(screen.getByText('4 tổng')).toBeInTheDocument();
    expect(screen.getByText('2 xong')).toBeInTheDocument();
    expect(screen.getByText('1 quá hạn')).toBeInTheDocument();
    await user.click(screen.getByText('Launch', { selector: 'strong' }));
    expect(await screen.findByRole('button', { name: /Prepare release/ })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tiến độ Launch' })).toHaveAttribute('aria-valuenow', '50');
  });

  it('creates a project manually and edits an existing project', async () => {
    const user = userEvent.setup();
    const onProjectsChange = vi.fn();
    render(<ProjectsPage projects={[project]} onProjectsChange={onProjectsChange} onEditTask={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    await user.type(screen.getByLabelText(/Tên dự án/), 'Research');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lưu dự án' }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith('/projects', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'Research', description: '', color: '#56846c' }),
    })));

    await user.click(screen.getByRole('button', { name: 'Sửa Launch' }));
    const name = within(screen.getByRole('dialog')).getByLabelText(/Tên dự án/);
    await user.clear(name);
    await user.type(name, 'Launch 2');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lưu dự án' }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith('/projects/project-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ name: 'Launch 2', description: 'Release checklist', color: '#df634d' }),
    })));
    expect(onProjectsChange).toHaveBeenCalledTimes(2);
  });

  it('previews a template, allows project customization, and creates its initial task plan', async () => {
    const user = userEvent.setup();
    render(<ProjectsPage projects={[]} onProjectsChange={() => {}} onEditTask={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Từ mẫu' }));
    await user.click(await screen.findByRole('tab', { name: 'Dự án công việc' }));
    expect(screen.getByText('Yêu cầu')).toBeInTheDocument();
    const name = screen.getByLabelText('Tên dự án');
    await user.clear(name);
    await user.type(name, 'Website refresh');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Tạo dự án' }));

    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith('/projects/from-template', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ templateId: 'work', name: 'Website refresh', description: 'Kế hoạch công việc', color: '#df634d' }),
    })));
  });

  it('shows project-template loading failures instead of silently hiding them', async () => {
    mockApiRequest.mockRejectedValueOnce(new Error('Không tải được mẫu.'));
    const user = userEvent.setup();
    render(<ProjectsPage projects={[]} onProjectsChange={() => {}} onEditTask={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Từ mẫu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được mẫu.');
  });
});

describe('subtask checklist', () => {
  it('marks subtasks complete and persists a reordered checklist', async () => {
    const user = userEvent.setup();
    render(<SubtaskList taskId="task-1" />);
    const reviewCheckbox = await screen.findByRole('checkbox', { name: 'Hoàn thành: Review' });
    await user.click(reviewCheckbox);
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith('/tasks/task-1/subtasks/sub-b', expect.objectContaining({ method: 'PATCH' })));

    await user.click(screen.getByRole('button', { name: 'Đưa Review lên' }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith('/tasks/task-1/subtasks/reorder', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ ids: ['sub-b', 'sub-a'] }),
    })));
    expect(screen.getByText('1/2 hoàn thành')).toBeInTheDocument();
  });

  it('rejects blank subtask titles and presents API load errors', async () => {
    mockApiRequest.mockRejectedValueOnce(new Error('Không thể tải checklist.'));
    const user = userEvent.setup();
    render(<SubtaskList taskId="task-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải checklist.');
    await user.type(screen.getByLabelText('Tên việc con mới'), '   ');
    expect(screen.getByRole('button', { name: 'Thêm việc con' })).toBeDisabled();
  });
});
