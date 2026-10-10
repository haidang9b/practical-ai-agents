export type Priority = 'high' | 'medium' | 'low'
export type TaskFilter = 'all' | 'today' | 'upcoming' | 'completed'

export interface Task {
  id: string
  title: string
  description: string
  category: string
  priority: Priority
  dueDate: string
  completed: boolean
  createdAt: string
}

export type TaskDraft = Omit<Task, 'id' | 'completed' | 'createdAt'>