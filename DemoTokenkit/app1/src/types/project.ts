export interface Project {
  id: string
  name: string
  description: string
  color: string
  archived: boolean
  createdAt: string
  updatedAt: string
  totalTasks: number
  activeTasks: number
  completedTasks: number
  overdueTasks: number
  progress: number
}

export interface ProjectDraft {
  name: string
  description: string
  color: string
}

export interface ProjectTemplate {
  id: 'study' | 'work' | 'personal'
  name: string
  description: string
  color: string
  tasks: string[]
}

export interface Subtask {
  id: string
  taskId: string
  title: string
  completed: boolean
  position: number
  createdAt: string
  updatedAt: string
}
