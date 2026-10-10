export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'all' | 'open' | 'done';
export type TaskSort = 'due' | 'priority' | 'recent';

export interface Task {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: Priority;
  dueDate: string;
  completed: boolean;
  createdAt: string;
}

export interface TaskDraft {
  title: string;
  description: string;
  category: string;
  priority: Priority;
  dueDate: string;
}