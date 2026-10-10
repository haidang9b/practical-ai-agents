export type Priority = 'high' | 'medium' | 'low'
export type TaskFilter = 'all' | 'today' | 'upcoming' | 'completed'
export type TaskStatus = 'todo' | 'in_progress' | 'done'

export interface Task {
  id: string
  title: string
  description: string
  category: string
  priority: Priority
  dueDate: string
  scheduledAt?: string | null
  status: TaskStatus
  completed: boolean
  completedAt?: string | null
  project: string
  projectId?: string | null
  subtaskCount?: number
  subtaskCompleted?: number
  tags: string[]
  createdAt: string
}

export type TaskDraft = Omit<Task, 'id' | 'completed' | 'createdAt' | 'status' | 'project' | 'projectId' | 'tags'> & Partial<Pick<Task, 'status' | 'project' | 'projectId' | 'tags'>>