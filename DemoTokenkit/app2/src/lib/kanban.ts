import type { BoardSort, BoardStatus, Priority, Task } from '../types';

export const boardColumns: { status: BoardStatus; title: string }[] = [
  { status: 'todo', title: 'Cần làm' },
  { status: 'in_progress', title: 'Đang thực hiện' },
  { status: 'done', title: 'Đã xong' },
];

export interface BoardFilters {
  project: string;
  tag: string;
  priority: Priority | 'all';
  due: 'all' | 'overdue' | 'today' | 'upcoming' | 'none';
  query: string;
}

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function filterAndSortTasks(tasks: Task[], filters: BoardFilters, sort: BoardSort, today: string): Task[] {
  const query = filters.query.trim().toLocaleLowerCase('vi');
  return tasks.filter((task) => {
    if (filters.project && task.project !== filters.project) return false;
    if (filters.tag && !task.tags.includes(filters.tag)) return false;
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (filters.due === 'overdue' && (!task.dueDate || task.dueDate >= today || task.status === 'done')) return false;
    if (filters.due === 'today' && task.dueDate !== today) return false;
    if (filters.due === 'upcoming' && (!task.dueDate || task.dueDate <= today)) return false;
    if (filters.due === 'none' && task.dueDate) return false;
    return !query || `${task.title} ${task.description} ${task.project} ${task.category} ${task.tags.join(' ')}`
      .toLocaleLowerCase('vi').includes(query);
  }).sort((first, second) => {
    if (sort === 'priority') return priorityRank[first.priority] - priorityRank[second.priority];
    if (sort === 'created') return second.createdAt.localeCompare(first.createdAt);
    if (!first.dueDate) return second.dueDate ? 1 : 0;
    if (!second.dueDate) return -1;
    return first.dueDate.localeCompare(second.dueDate);
  });
}