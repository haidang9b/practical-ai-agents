import type { BoardStatus, Task } from '../types';

export const TASKS_KEY = 'viec-nho.tasks.v1';
export const THEME_KEY = 'viec-nho.theme.v1';

export function taskStorageKey(owner?: string): string {
  return owner ? `${TASKS_KEY}:${owner}` : TASKS_KEY;
}

const starterTasks: Task[] = [
  {
    id: 'starter-1',
    title: 'Gửi bản đề xuất cho nhóm thiết kế',
    description: 'Chốt phần ngân sách và gửi trước buổi họp chiều.',
    category: 'Công việc',
    priority: 'high',
    dueDate: new Date().toISOString().slice(0, 10),
    status: 'todo',
    completed: false,
    createdAt: new Date().toISOString(),
    project: 'Công việc',
    tags: [],
  },
  {
    id: 'starter-2',
    title: 'Đặt lịch khám răng',
    description: 'Kiểm tra lịch trống vào cuối tuần.',
    category: 'Cá nhân',
    priority: 'medium',
    dueDate: '',
    status: 'todo',
    completed: false,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    project: 'Cá nhân',
    tags: [],
  },
  {
    id: 'starter-3',
    title: 'Đọc 20 trang sách mới',
    description: '',
    category: 'Học tập',
    priority: 'low',
    dueDate: '',
    status: 'done',
    completed: true,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    project: 'Học tập',
    tags: [],
  },
];

const boardStatuses: BoardStatus[] = ['todo', 'in_progress', 'done'];

function normalizeTask(value: unknown): Task {
  const task = value && typeof value === 'object' ? value as Partial<Task> : {};
  const status = boardStatuses.includes(task.status as BoardStatus)
    ? task.status as BoardStatus
    : task.completed ? 'done' : 'todo';
  return {
    ...task,
    id: typeof task.id === 'string' ? task.id : crypto.randomUUID(),
    title: typeof task.title === 'string' ? task.title : '',
    description: typeof task.description === 'string' ? task.description : '',
    category: typeof task.category === 'string' ? task.category : 'Công việc',
    priority: task.priority === 'low' || task.priority === 'high' ? task.priority : 'medium',
    dueDate: typeof task.dueDate === 'string' ? task.dueDate : '',
    scheduledAt: typeof task.scheduledAt === 'string' ? task.scheduledAt : '',
    status,
    completed: status === 'done',
    createdAt: typeof task.createdAt === 'string' ? task.createdAt : new Date().toISOString(),
    project: typeof task.project === 'string' ? task.project : task.category || 'Công việc',
    projectId: typeof task.projectId === 'string' ? task.projectId : null,
    tags: Array.isArray(task.tags) ? task.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  };
}

export function loadTasks(owner?: string): Task[] {
  try {
    const stored = localStorage.getItem(taskStorageKey(owner));
    if (stored === null) return starterTasks;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(normalizeTask) : starterTasks;
  } catch {
    return starterTasks;
  }
}

export function saveTasks(tasks: Task[], owner?: string): void {
  localStorage.setItem(taskStorageKey(owner), JSON.stringify(tasks));
}

export function loadTheme(): 'light' | 'dark' {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}