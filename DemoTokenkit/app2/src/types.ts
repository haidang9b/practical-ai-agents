export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'all' | 'open' | 'done';
export type TaskSort = 'due' | 'priority' | 'recent';
export type BoardStatus = 'todo' | 'in_progress' | 'done';
export type BoardSort = 'priority' | 'due' | 'created';

export interface Task {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: Priority;
  dueDate: string;
  scheduledAt?: string;
  status: BoardStatus;
  completed: boolean;
  completedAt?: string | null;
  createdAt: string;
  project: string;
  projectId?: string | null;
  tags: string[];
}

export interface TaskDraft {
  title: string;
  description: string;
  category: string;
  priority: Priority;
  dueDate: string;
  scheduledAt: string;
  project: string;
  projectId?: string;
  tags: string[];
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string;
  color: string;
  archived: number;
  created_at: string;
  updated_at: string;
  total_count: number;
  active_count: number;
  completed_count: number;
  overdue_count: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  tasks: string[];
}