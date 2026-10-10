import type { Task } from '../types';

export const TASKS_KEY = 'viec-nho.tasks.v1';
export const THEME_KEY = 'viec-nho.theme.v1';

const starterTasks: Task[] = [
  {
    id: 'starter-1',
    title: 'Gửi bản đề xuất cho nhóm thiết kế',
    description: 'Chốt phần ngân sách và gửi trước buổi họp chiều.',
    category: 'Công việc',
    priority: 'high',
    dueDate: new Date().toISOString().slice(0, 10),
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'starter-2',
    title: 'Đặt lịch khám răng',
    description: 'Kiểm tra lịch trống vào cuối tuần.',
    category: 'Cá nhân',
    priority: 'medium',
    dueDate: '',
    completed: false,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'starter-3',
    title: 'Đọc 20 trang sách mới',
    description: '',
    category: 'Học tập',
    priority: 'low',
    dueDate: '',
    completed: true,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

export function loadTasks(): Task[] {
  try {
    const stored = localStorage.getItem(TASKS_KEY);
    if (stored === null) return starterTasks;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as Task[]) : starterTasks;
  } catch {
    return starterTasks;
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function loadTheme(): 'light' | 'dark' {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}