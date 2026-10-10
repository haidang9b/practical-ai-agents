import { useMemo, useState } from 'react'
import { ArrowDownUp, CalendarDays, CircleAlert, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { Priority, Task, TaskStatus } from '../types/task'

const columns: Array<{ status: TaskStatus; title: string }> = [
  { status: 'todo', title: 'To Do' },
  { status: 'in_progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]
const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
const priorityLabel: Record<Priority, string> = { high: 'Cao', medium: 'Vừa', low: 'Thấp' }

interface KanbanPageProps {
  tasks: Task[]
  isLoading: boolean
  onCreate: () => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
}

function formatDate(value: string): string {
  if (!value) return 'Chưa có hạn'
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00`))
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function KanbanPage({ tasks, isLoading, onCreate, onEdit, onDelete, onMove }: KanbanPageProps) {
  const [query, setQuery] = useState('')
  const [project, setProject] = useState('all')
  const [tag, setTag] = useState('all')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [due, setDue] = useState<'all' | 'overdue' | 'today' | 'upcoming' | 'none'>('all')
  const [sortBy, setSortBy] = useState<'priority' | 'due' | 'created'>('created')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null)
  const today = localDateKey(new Date())
  const projects = [...new Set(tasks.map((task) => task.project).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const tags = [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort((a, b) => a.localeCompare(b))
  const hasFilters = Boolean(query || project !== 'all' || tag !== 'all' || priority !== 'all' || due !== 'all')

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const text = `${task.title} ${task.description}`.toLocaleLowerCase('vi')
    if (query.trim() && !text.includes(query.trim().toLocaleLowerCase('vi'))) return false
    if (project !== 'all' && task.project !== project) return false
    if (tag !== 'all' && !(task.tags ?? []).includes(tag)) return false
    if (priority !== 'all' && task.priority !== priority) return false
    if (due === 'overdue' && (!task.dueDate || task.dueDate >= today || task.status === 'done')) return false
    if (due === 'today' && task.dueDate !== today) return false
    if (due === 'upcoming' && (!task.dueDate || task.dueDate <= today)) return false
    if (due === 'none' && task.dueDate) return false
    return true
  }).sort((first, second) => {
    if (sortBy === 'priority') return priorityRank[first.priority] - priorityRank[second.priority]
    if (sortBy === 'created') return second.createdAt.localeCompare(first.createdAt)
    if (!first.dueDate) return 1
    if (!second.dueDate) return -1
    return first.dueDate.localeCompare(second.dueDate)
  }), [tasks, query, project, tag, priority, due, sortBy, today])

  const clearFilters = () => {
    setQuery('')
    setProject('all')
    setTag('all')
    setPriority('all')
    setDue('all')
  }

  const dropTask = (event: React.DragEvent<HTMLElement>, status: TaskStatus) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain') || draggingId
    const task = tasks.find((item) => item.id === taskId)
    setDraggingId(null)
    setDropTarget(null)
    if (!task || task.status === status) return
    onMove(task, status)
  }

  return <section className="kanban-page" aria-label="Bảng Kanban">
    <div className="kanban-toolbar">
      <label className="kanban-search"><Search size={16} /><input aria-label="Tìm trên bảng" placeholder="Tìm tiêu đề hoặc mô tả..." value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Xóa tìm kiếm bảng" onClick={() => setQuery('')}><X size={14} /></button>}</label>
      <label className="kanban-filter">Dự án<select aria-label="Lọc dự án" value={project} onChange={(event) => setProject(event.target.value)}><option value="all">Tất cả dự án</option>{projects.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label className="kanban-filter">Thẻ<select aria-label="Lọc thẻ" value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">Tất cả thẻ</option>{tags.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label className="kanban-filter">Ưu tiên<select aria-label="Lọc ưu tiên bảng" value={priority} onChange={(event) => setPriority(event.target.value as Priority | 'all')}><option value="all">Tất cả</option><option value="high">Cao</option><option value="medium">Vừa</option><option value="low">Thấp</option></select></label>
      <label className="kanban-filter">Hạn<select aria-label="Lọc ngày đến hạn" value={due} onChange={(event) => setDue(event.target.value as typeof due)}><option value="all">Tất cả ngày</option><option value="overdue">Quá hạn</option><option value="today">Hôm nay</option><option value="upcoming">Sắp tới</option><option value="none">Không có hạn</option></select></label>
      <label className="kanban-sort"><ArrowDownUp size={14} /><select aria-label="Sắp xếp bảng" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="created">Ngày tạo</option><option value="priority">Ưu tiên</option><option value="due">Ngày đến hạn</option></select></label>
      {hasFilters && <button className="kanban-clear" onClick={clearFilters}>Xóa bộ lọc</button>}
      <button className="kanban-add-button" onClick={onCreate}><Plus size={15} />Thêm việc</button>
    </div>

    {isLoading ? <div className="kanban-loading" role="status">Đang tải công việc...</div> : <div className="kanban-columns">
      {columns.map(({ status, title }) => {
        const columnTasks = visibleTasks.filter((task) => (task.status ?? (task.completed ? 'done' : 'todo')) === status)
        return <section className={`kanban-column ${dropTarget === status ? 'is-drop-target' : ''}`} key={status} aria-label={`${title}, ${columnTasks.length} công việc`}
          onDragOver={(event) => { event.preventDefault(); setDropTarget(status) }}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDropTarget(null) }}
          onDrop={(event) => dropTask(event, status)}>
          <header className="kanban-column-heading"><span className={`kanban-status-mark mark-${status}`} /><h2>{title}</h2><span className="kanban-count" aria-label={`${columnTasks.length} công việc`}>{columnTasks.length}</span></header>
          <div className="kanban-card-list">
            {columnTasks.map((task) => {
              const overdue = Boolean(task.dueDate && task.dueDate < today && status !== 'done')
              return <article key={task.id} className={`kanban-card ${task.priority === 'high' ? 'is-high-priority' : ''} ${overdue ? 'is-overdue' : ''} ${draggingId === task.id ? 'is-dragging' : ''}`}
                draggable
                onDragStart={(event) => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; setDraggingId(task.id) }}
                onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}>
                <div className="kanban-card-top"><span className={`kanban-priority priority-${task.priority}`}>{priorityLabel[task.priority]}</span>{overdue && <span className="kanban-overdue"><CircleAlert size={12} />Quá hạn</span>}</div>
                <button className="kanban-card-title" onClick={() => onEdit(task)}>{task.title}</button>
                {task.description && <p className="kanban-card-description">{task.description}</p>}
                <div className="kanban-card-tags">{task.project && <span className="kanban-project">{task.project}</span>}{(task.tags ?? []).map((taskTag) => <span className="kanban-tag" key={taskTag}>{taskTag}</span>)}</div>
                <div className="kanban-card-footer"><span className={`kanban-due ${overdue ? 'is-overdue' : ''}`}><CalendarDays size={12} />{formatDate(task.dueDate)}</span><div className="kanban-card-actions"><label className="kanban-status-control"><span className="visually-hidden">Trạng thái {task.title}</span><select aria-label={`Trạng thái: ${task.title}`} value={status} onChange={(event) => onMove(task, event.target.value as TaskStatus)}><option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="done">Done</option></select></label><button aria-label={`Chỉnh sửa ${task.title}`} title="Chỉnh sửa" onClick={() => onEdit(task)}><Pencil size={13} /></button><button aria-label={`Xóa ${task.title}`} title="Xóa" onClick={() => onDelete(task)}><Trash2 size={13} /></button></div></div>
              </article>
            })}
            {columnTasks.length === 0 && <div className="kanban-empty">{hasFilters ? 'Không có việc phù hợp.' : 'Chưa có công việc.'}</div>}
          </div>
        </section>
      })}
    </div>}
  </section>
}

export default KanbanPage