import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlarmClock,
  ArrowDownUp,
  BarChart3,
  CalendarDays,
  Check,
  CheckCheck,
  Circle,
  CircleHelp,
  Columns3,
  ClipboardList,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Repeat2,
  Moon,
  Pencil,
  Plus,
  Search,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { createTask, deleteTask, getProjects, getTasks, restoreSession, signOut, updateTask, type SessionUser } from './lib/api'
import AuthScreen from './components/AuthScreen'
import CalendarPage from './components/CalendarPage'
import KanbanPage from './components/KanbanPage'
import ProjectsPage from './components/ProjectsPage'
import AnalyticsPage from './components/AnalyticsPage'
import HabitTrackerPage from './components/HabitTrackerPage'
import SubtaskList from './components/SubtaskList'
import { readTheme, saveTheme } from './lib/storage'
import type { Priority, Task, TaskDraft, TaskFilter, TaskStatus } from './types/task'
import type { Project } from './types/project'

const categories = ['Công việc', 'Cá nhân', 'Học tập', 'Sức khỏe']
const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
const emptyDraft: TaskDraft = {
  title: '',
  description: '',
  category: 'Công việc',
  priority: 'medium',
  dueDate: '',
  status: 'todo',
  project: '',
  projectId: null,
  tags: [],
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value: string): string {
  if (!value) return 'Chưa có hạn'
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00`))
}

interface TaskDashboardProps {
  user: SessionUser
  token: string
  onTokenRefresh: (token: string) => void
  onLogout: () => void
}

function TaskDashboard({ user, token, onTokenRefresh, onLogout }: TaskDashboardProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [taskError, setTaskError] = useState('')
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [isDark, setIsDark] = useState(readTheme)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  const [isKanbanOpen, setIsKanbanOpen] = useState(false)
  const [isProjectsOpen, setIsProjectsOpen] = useState(false)
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false)
  const [isHabitOpen, setIsHabitOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'priority' | 'created'>('date')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft)

  useEffect(() => {
    let isCurrent = true
    setIsLoadingTasks(true)
    Promise.all([getTasks(token, onTokenRefresh), getProjects(token, onTokenRefresh)])
      .then(([taskResult, projectResult]) => { if (isCurrent) { setTasks(taskResult.tasks); setProjects(projectResult.projects) } })
      .catch((error: unknown) => { if (isCurrent) setTaskError(error instanceof Error ? error.message : 'Không thể tải công việc.') })
      .finally(() => { if (isCurrent) setIsLoadingTasks(false) })
    return () => { isCurrent = false }
  }, [token, onTokenRefresh])

  const refreshProjects = () => getProjects(token, onTokenRefresh).then(({ projects: loaded }) => setProjects(loaded)).catch(() => undefined)
  const refreshTasks = () => getTasks(token, onTokenRefresh).then(({ tasks: loaded }) => setTasks(loaded)).then(refreshProjects)
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
    saveTheme(isDark)
  }, [isDark])

  const today = localDateString()
  const activeCount = tasks.filter((task) => !task.completed).length
  const completedCount = tasks.filter((task) => task.completed).length
  const dueTodayCount = tasks.filter((task) => !task.completed && task.dueDate === today).length
  const highPriorityCount = tasks.filter((task) => !task.completed && task.priority === 'high').length

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    const filtered = tasks.filter((task) => {
      if (filter === 'today' && (task.completed || task.dueDate !== today)) return false
      if (filter === 'upcoming' && (task.completed || !task.dueDate || task.dueDate <= today)) return false
      if (filter === 'completed' && !task.completed) return false
      if (filter === 'all' && task.completed) return false
      if (categoryFilter && task.category !== categoryFilter) return false
      if (projectFilter === 'unassigned' && task.projectId) return false
      if (projectFilter !== 'all' && projectFilter !== 'unassigned' && task.projectId !== projectFilter) return false
      return !normalizedQuery || `${task.title} ${task.description} ${task.category}`.toLocaleLowerCase('vi').includes(normalizedQuery)
    })

    return filtered.sort((first, second) => {
      if (sortBy === 'priority') return priorityRank[first.priority] - priorityRank[second.priority]
      if (sortBy === 'created') return second.createdAt.localeCompare(first.createdAt)
      if (!first.dueDate) return 1
      if (!second.dueDate) return -1
      return first.dueDate.localeCompare(second.dueDate)
    })
  }, [tasks, filter, categoryFilter, projectFilter, query, sortBy, today])

  const openNewTask = (projectId?: string) => {
    setEditingTask(null)
    setDraft({ ...emptyDraft, projectId: projectId ?? null, project: projects.find((project) => project.id === projectId)?.name ?? '' })
    setIsFormOpen(true)
  }

  const openCalendarTask = (dateKey: string) => {
    setEditingTask(null)
    setDraft({ ...emptyDraft, scheduledAt: dateKey })
    setIsFormOpen(true)
  }

  const openEditTask = (task: Task) => {
    setEditingTask(task)
    setDraft({ title: task.title, description: task.description, category: task.category, priority: task.priority, dueDate: task.dueDate, scheduledAt: task.scheduledAt ?? '', status: task.status, project: task.project, projectId: task.projectId ?? null, tags: task.tags })
    setIsFormOpen(true)
  }

  const moveKanbanTask = async (task: Task, status: TaskStatus) => {
    if (task.status === status) return
    const updatedLocally = { ...task, status, completed: status === 'done' }
    setTasks((current) => current.map((item) => item.id === task.id ? updatedLocally : item))
    setTaskError('')
    try {
      const { task: updatedTask } = await updateTask(token, task.id, { status }, onTokenRefresh)
      setTasks((current) => current.map((item) => item.id === updatedTask.id ? updatedTask : item))
      void refreshProjects()
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item))
      setTaskError(error instanceof Error ? error.message : 'Không thể đổi trạng thái công việc.')
    }
  }

  const moveCalendarTask = async (task: Task, scheduledAt: string) => {
    try {
      const { task: updatedTask } = await updateTask(token, task.id, { scheduledAt }, onTokenRefresh)
      setTasks((current) => current.map((item) => item.id === updatedTask.id ? updatedTask : item))
      void refreshProjects()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Không thể đổi ngày công việc.')
    }
  }

  const saveTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = draft.title.trim()
    if (!title) return

    setTaskError('')
    try {
      if (editingTask) {
        const { task } = await updateTask(token, editingTask.id, { ...draft, title }, onTokenRefresh)
        setTasks((current) => current.map((item) => item.id === task.id ? task : item))
        void refreshProjects()
      } else {
        const { task } = await createTask(token, { ...draft, title }, onTokenRefresh)
        setTasks((current) => [task, ...current])
        void refreshProjects()
      }
      setIsFormOpen(false)
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Không thể lưu công việc.')
    }
  }

  const toggleTask = async (task: Task) => {
    try {
      const completed = !task.completed
      const { task: updatedTask } = await updateTask(token, task.id, { completed, status: completed ? 'done' : 'todo' }, onTokenRefresh)
      setTasks((current) => current.map((item) => item.id === updatedTask.id ? updatedTask : item))
      void refreshProjects()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Không thể cập nhật công việc.')
    }
  }

  const removeTask = async (task: Task) => {
    try {
      await deleteTask(token, task.id, onTokenRefresh)
      setTasks((current) => current.filter((item) => item.id !== task.id))
      void refreshProjects()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Không thể xóa công việc.')
    }
  }

  const title = isHabitOpen ? 'Thói quen' : isAnalyticsOpen ? 'Phân tích năng suất' : isProjectsOpen ? 'Dự án' : isCalendarOpen ? 'Lịch & kế hoạch tuần' : isKanbanOpen ? 'Bảng Kanban' : categoryFilter ?? ({ all: 'Tất cả công việc', today: 'Việc hôm nay', upcoming: 'Sắp tới', completed: 'Đã hoàn thành' } satisfies Record<TaskFilter, string>)[filter]
  const greetingDate = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  const setView = (nextFilter: TaskFilter) => {
    setIsCalendarOpen(false)
    setIsKanbanOpen(false)
    setIsProjectsOpen(false)
    setIsAnalyticsOpen(false)
    setIsHabitOpen(false)
    setFilter(nextFilter)
    setCategoryFilter(null)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={() => setView('all')} aria-label="Việc Nhỏ, trang chủ">
          <span className="brand-mark"><CheckCheck size={19} strokeWidth={2.6} /></span>
          <span>việc nhỏ<span className="brand-period">.</span></span>
        </a>

        <div className="side-label">KHÔNG GIAN CỦA BẠN</div>
        <nav className="main-nav" aria-label="Điều hướng chính">
          <button className={`nav-item ${!isAnalyticsOpen && !isCalendarOpen && !isKanbanOpen && !isProjectsOpen && !isHabitOpen && filter === 'all' && !categoryFilter ? 'active' : ''}`} onClick={() => setView('all')}>
            <LayoutDashboard size={17} /><span>Tổng quan</span><span className="nav-count">{activeCount}</span>
          </button>
          <button className={`nav-item ${isKanbanOpen ? 'active' : ''}`} onClick={() => { setIsCalendarOpen(false); setIsKanbanOpen(true); setIsProjectsOpen(false); setIsAnalyticsOpen(false); setIsHabitOpen(false); setCategoryFilter(null) }}>
            <Columns3 size={17} /><span>Bảng Kanban</span>
          </button>
          <button className={`nav-item ${isProjectsOpen ? 'active' : ''}`} onClick={() => { setIsCalendarOpen(false); setIsKanbanOpen(false); setIsProjectsOpen(true); setIsAnalyticsOpen(false); setIsHabitOpen(false); setCategoryFilter(null) }}>
            <FolderKanban size={17} /><span>Dự án</span><span className="nav-count">{projects.filter((project) => !project.archived).length}</span>
          </button>
          <button className={`nav-item ${isAnalyticsOpen ? 'active' : ''}`} onClick={() => { setIsCalendarOpen(false); setIsKanbanOpen(false); setIsProjectsOpen(false); setIsAnalyticsOpen(true); setIsHabitOpen(false); setCategoryFilter(null) }}>
            <BarChart3 size={17} /><span>Phân tích</span>
          </button>
          <button className={`nav-item ${isHabitOpen ? 'active' : ''}`} onClick={() => { setIsCalendarOpen(false); setIsKanbanOpen(false); setIsProjectsOpen(false); setIsAnalyticsOpen(false); setIsHabitOpen(true); setCategoryFilter(null) }}>
            <Repeat2 size={17} /><span>Thói quen</span>
          </button>
          <button className={`nav-item ${filter === 'today' && !isAnalyticsOpen && !isHabitOpen ? 'active' : ''}`} onClick={() => setView('today')}>
            <ListTodo size={17} /><span>Hôm nay</span><span className="nav-count">{dueTodayCount}</span>
          </button>
          <button className={`nav-item ${filter === 'upcoming' && !isAnalyticsOpen && !isHabitOpen ? 'active' : ''}`} onClick={() => setView('upcoming')}>
            <Clock3 size={17} /><span>Sắp tới</span>
          </button>
          <button className={`nav-item ${filter === 'completed' && !isAnalyticsOpen && !isHabitOpen ? 'active' : ''}`} onClick={() => setView('completed')}>
            <Check size={17} /><span>Đã hoàn thành</span><span className="nav-count">{completedCount}</span>
          </button>
          <button className={`nav-item ${isCalendarOpen ? 'active' : ''}`} onClick={() => { setIsCalendarOpen(true); setIsKanbanOpen(false); setIsProjectsOpen(false); setIsAnalyticsOpen(false); setIsHabitOpen(false); setCategoryFilter(null) }}>
            <CalendarDays size={17} /><span>Lịch & kế hoạch</span>
          </button>
        </nav>

        <div className="side-label category-label">NHÓM CÔNG VIỆC</div>
        <nav className="category-nav" aria-label="Lọc theo nhóm">
          {categories.map((category, index) => (
            <button key={category} className={`category-item ${categoryFilter === category ? 'selected' : ''}`} onClick={() => { setIsCalendarOpen(false); setIsKanbanOpen(false); setIsProjectsOpen(false); setIsAnalyticsOpen(false); setIsHabitOpen(false); setCategoryFilter(category); setFilter('all') }}>
              <span className={`category-dot dot-${index}`} />{category}
              <span className="category-count">{tasks.filter((task) => task.category === category && !task.completed).length}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="focus-note"><span className="focus-icon"><AlarmClock size={15} /></span><p>Mỗi việc nhỏ<br />đều tạo nên khác biệt.</p><span className="note-spark">✳</span></div>
          <div className="profile-button">
            <span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="profile-text"><strong>{user.displayName}</strong><small>{user.email}</small></span>
            <button className="sidebar-logout" onClick={onLogout} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Không gian</span><span className="crumb-slash">/</span><strong>{title}</strong></div>
          <div className="topbar-actions">
            <span className="today-date">{greetingDate}</span>
            <button className="icon-button theme-toggle" onClick={() => setIsDark((value) => !value)} aria-label={isDark ? 'Giao diện sáng' : 'Giao diện tối'} title="Đổi giao diện">
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="icon-button logout-button" onClick={onLogout} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={17} /></button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" />GÓC LÀM VIỆC CỦA BẠN</p>
                <h1>{!isAnalyticsOpen && !isCalendarOpen && !isKanbanOpen && !isProjectsOpen && !isHabitOpen && filter === 'all' && !categoryFilter ? <>Chào buổi sáng, <span>{user.displayName}.</span></> : title}</h1>
                  <p className="welcome-subtitle">{isHabitOpen ? 'Xây dựng nhịp sống tốt từ những lần lặp lại nhỏ.' : isAnalyticsOpen ? 'Nhìn lại tiến độ, nhịp tập trung và thói quen của bạn.' : isProjectsOpen ? 'Gom mục tiêu, công việc và tiến độ vào cùng một nơi.' : isCalendarOpen ? 'Sắp xếp nhịp tuần, giữ hạn chót trong tầm mắt.' : isKanbanOpen ? 'Theo dõi tiến độ và chuyển việc giữa các trạng thái.' : filter === 'all' && !categoryFilter ? 'Một ngày mới, một cơ hội mới để tiến thêm một bước.' : 'Tập trung vào điều quan trọng nhất với bạn.'}</p>
            </div>
                {!isCalendarOpen && !isProjectsOpen && !isAnalyticsOpen && !isHabitOpen && <button className="primary-button" onClick={() => openNewTask()}><Plus size={18} strokeWidth={2.5} /><span>Thêm công việc</span></button>}
          </section>

              {isHabitOpen ? <HabitTrackerPage token={token} onTokenRefresh={onTokenRefresh} /> : isAnalyticsOpen ? <AnalyticsPage token={token} tasks={tasks} projects={projects} onTokenRefresh={onTokenRefresh} /> : isProjectsOpen ? <ProjectsPage token={token} onTokenRefresh={onTokenRefresh} tasks={tasks} onEditTask={openEditTask} onCreateTask={(projectId) => openNewTask(projectId)} onProjectsChanged={refreshProjects} onTasksChanged={() => { void refreshTasks() }} /> : isKanbanOpen ? <>
            {taskError && <p className="task-error" role="alert">{taskError}</p>}
            <KanbanPage tasks={tasks} isLoading={isLoadingTasks} onCreate={openNewTask} onEdit={openEditTask} onDelete={(task) => void removeTask(task)} onMove={(task, status) => void moveKanbanTask(task, status)} />
          </> : isCalendarOpen ? <CalendarPage tasks={tasks} onCreate={openCalendarTask} onEdit={openEditTask} onMove={(task, dateKey) => void moveCalendarTask(task, dateKey)} onToggle={(task) => void toggleTask(task)} /> : <>
          <section className="stats-grid" aria-label="Thống kê công việc">
            <article className="stat-panel stat-total"><span className="stat-icon"><ClipboardList size={17} /></span><span className="stat-label">ĐANG THỰC HIỆN</span><strong>{activeCount.toString().padStart(2, '0')}</strong><span className="stat-foot">công việc đang chờ bạn</span><span className="stat-decoration">↗</span></article>
            <article className="stat-panel stat-today"><span className="stat-icon"><Clock3 size={17} /></span><span className="stat-label">HẠN HÔM NAY</span><strong>{dueTodayCount.toString().padStart(2, '0')}</strong><span className="stat-foot">việc cần hoàn thành hôm nay</span><span className="stat-decoration">◷</span></article>
            <article className="stat-panel stat-done"><span className="stat-icon"><CheckCheck size={17} /></span><span className="stat-label">ĐÃ HOÀN THÀNH</span><strong>{completedCount.toString().padStart(2, '0')}</strong><span className="stat-foot">bạn đã làm rất tốt!</span><span className="stat-decoration">✳</span></article>
            <article className="stat-panel stat-focus"><span className="stat-icon"><CircleHelp size={17} /></span><span className="stat-label">CẦN ƯU TIÊN</span><strong>{highPriorityCount.toString().padStart(2, '0')}</strong><span className="stat-foot">việc quan trọng cần chú ý</span><span className="stat-decoration">!</span></article>
          </section>

          <section className="task-section">
            <div className="section-heading">
              <div><div className="section-title-line"><h2>{filter === 'all' && !categoryFilter ? 'Danh sách công việc' : title}</h2><span className="task-total">{visibleTasks.length}</span></div><p>Những điều bạn đang tập trung hôm nay</p></div>
              <button className="text-button" onClick={() => openNewTask()}><Plus size={16} /> Tạo mới</button>
            </div>

            <div className="task-toolbar">
              <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm công việc..." aria-label="Tìm công việc" />{query && <button onClick={() => setQuery('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}</label>
              <label className="sort-control"><FolderKanban size={14} /><select aria-label="Lọc theo dự án" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">Mọi dự án</option><option value="unassigned">Chưa gán</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="sort-control"><ArrowDownUp size={15} /><span>Sắp xếp</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} aria-label="Sắp xếp công việc"><option value="date">Ngày đến hạn</option><option value="priority">Độ ưu tiên</option><option value="created">Mới tạo</option></select></label>
            </div>

            {taskError && <p className="task-error" role="alert">{taskError}</p>}
            {isLoadingTasks ? <div className="empty-state"><span className="empty-icon"><ClipboardList size={23} /></span><h3>Đang tải công việc...</h3></div> : visibleTasks.length > 0 ? <div className="task-list" aria-label="Danh sách công việc">
              {visibleTasks.map((task) => <article className={`task-row ${task.completed ? 'is-complete' : ''}`} key={task.id}>
                <button className={`complete-button ${task.completed ? 'checked' : ''}`} onClick={() => void toggleTask(task)} aria-label={task.completed ? `Đánh dấu chưa hoàn thành: ${task.title}` : `Hoàn thành: ${task.title}`}>
                  {task.completed ? <Check size={14} /> : <Circle size={19} strokeWidth={1.6} />}
                </button>
                <div className="task-main"><div className="task-title-line"><h3>{task.title}</h3><span className={`priority-dot priority-${task.priority}`} title={`Ưu tiên ${task.priority}`} /></div>{task.description && <p className="task-description">{task.description}</p>}<div className="task-meta"><span className={`task-category category-${categories.indexOf(task.category) % 4}`}><Tag size={12} />{task.category}</span><span className={`task-due ${!task.completed && task.dueDate && task.dueDate < today ? 'overdue' : ''}`}><Clock3 size={12} />{formatDate(task.dueDate)}</span>{Boolean(task.subtaskCount) && <span className="task-subtask-count">{task.subtaskCompleted}/{task.subtaskCount} bước</span>}</div></div>
                <span className={`priority-label label-${task.priority}`}>{task.priority === 'high' ? 'Cao' : task.priority === 'medium' ? 'Vừa' : 'Thấp'}</span>
                <div className="task-actions"><button onClick={() => openEditTask(task)} aria-label={`Chỉnh sửa ${task.title}`} title="Chỉnh sửa"><Pencil size={15} /></button><button onClick={() => void removeTask(task)} aria-label={`Xóa ${task.title}`} title="Xóa"><Trash2 size={15} /></button></div>
              </article>)}
            </div> : <div className="empty-state"><span className="empty-icon"><ClipboardList size={23} /></span><h3>{query ? 'Không tìm thấy công việc' : 'Chưa có công việc nào'}</h3><p>{query ? 'Thử một từ khóa khác nhé.' : 'Thêm việc đầu tiên để bắt đầu ngày mới thật chủ động.'}</p>{!query && <button className="text-button" onClick={() => openNewTask()}><Plus size={16} /> Thêm công việc đầu tiên</button>}</div>}
          </section>
          </>}
          <footer className="page-footer"><span>Chậm mà chắc, bạn đang tiến về phía trước.</span><span>ĐÃ LƯU TỰ ĐỘNG <span className="saved-dot" /></span></footer>
        </div>
      </main>

      {isFormOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsFormOpen(false) }}>
        <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-heading"><div><p className="eyebrow"><span className="eyebrow-line" />MỘT BƯỚC TIẾN MỚI</p><h2 id="modal-title">{editingTask ? 'Chỉnh sửa công việc' : 'Thêm công việc mới'}</h2></div><button className="icon-button" onClick={() => setIsFormOpen(false)} aria-label="Đóng"><X size={19} /></button></div>
          <form onSubmit={saveTask}>
            <label className="field-label">Tên công việc<input autoFocus required maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ví dụ: Hoàn thành bản kế hoạch" /></label>
            <label className="field-label">Mô tả <span className="optional-label">KHÔNG BẮT BUỘC</span><textarea rows={3} maxLength={300} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Thêm một vài chi tiết..." /></label>
            <div className="field-grid"><label className="field-label">Nhóm<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="field-label">Ưu tiên<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}><option value="low">Thấp</option><option value="medium">Vừa</option><option value="high">Cao</option></select></label></div>
            <div className="field-grid"><label className="field-label">Dự án <span className="optional-label">KHÔNG BẮT BUỘC</span><select value={draft.projectId ?? (editingTask?.project ? 'legacy' : '')} onChange={(event) => { const selected = event.target.value; const project = projects.find((item) => item.id === selected); setDraft({ ...draft, projectId: project?.id ?? null, project: project?.name ?? (selected === 'legacy' ? editingTask?.project ?? '' : '') }) }}><option value="">Chưa gán</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}{editingTask?.project && !editingTask.projectId && <option value="legacy">{editingTask.project} (nhãn cũ)</option>}</select></label><label className="field-label">Thẻ <span className="optional-label">PHÂN CÁCH BẰNG DẤU PHẨY</span><input maxLength={360} value={(draft.tags ?? []).join(', ')} onChange={(event) => setDraft({ ...draft, tags: [...new Set(event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 12) })} placeholder="Thiết kế, Khẩn cấp" /></label></div>
            {editingTask && <label className="field-label">Trạng thái<select aria-label="Trạng thái công việc" value={draft.status ?? 'todo'} onChange={(event) => setDraft({ ...draft, status: event.target.value as TaskStatus })}><option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="done">Done</option></select></label>}
            <label className="field-label">Ngày đến hạn <span className="optional-label">KHÔNG BẮT BUỘC</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
            {editingTask && <SubtaskList key={editingTask.id} token={token} taskId={editingTask.id} onTokenRefresh={onTokenRefresh} onSubtasksChanged={() => { void refreshTasks() }} />}
            <div className="field-grid"><label className="field-label">Ngày lên lịch <span className="optional-label">KHÔNG BẮT BUỘC</span><input aria-label="Ngày lên lịch" type="date" value={draft.scheduledAt?.slice(0, 10) ?? ''} onChange={(event) => { const time = draft.scheduledAt?.match(/T(\d{2}:\d{2})$/)?.[1]; setDraft({ ...draft, scheduledAt: event.target.value ? `${event.target.value}${time ? `T${time}` : ''}` : '' }) }} /></label><label className="field-label">Giờ bắt đầu <span className="optional-label">TÙY CHỌN</span><input aria-label="Giờ bắt đầu" type="time" disabled={!draft.scheduledAt} value={draft.scheduledAt?.match(/T(\d{2}:\d{2})$/)?.[1] ?? ''} onChange={(event) => { const date = draft.scheduledAt?.slice(0, 10); setDraft({ ...draft, scheduledAt: date ? event.target.value ? `${date}T${event.target.value}` : date : '' }) }} /></label></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsFormOpen(false)}>Hủy</button><button type="submit" className="primary-button"><Plus size={17} />{editingTask ? 'Lưu thay đổi' : 'Tạo công việc'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  )
}

function App() {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    restoreSession().then((session) => {
      if (!isCurrent || !session) return
      setUser(session.user)
      setToken(session.accessToken)
    }).finally(() => { if (isCurrent) setAuthLoading(false) })
    const expireSession = () => { setUser(null); setToken(null) }
    window.addEventListener('viec-nho:session-expired', expireSession)
    return () => {
      isCurrent = false
      window.removeEventListener('viec-nho:session-expired', expireSession)
    }
  }, [])

  const logout = async () => {
    try { await signOut() } finally { setUser(null); setToken(null) }
  }

  if (authLoading) return <main className="auth-loading"><span className="brand-mark"><CheckCheck size={19} /></span><span>Đang mở không gian của bạn...</span></main>
  if (!user || !token) return <AuthScreen onAuthenticated={(session) => { setUser(session.user); setToken(session.accessToken) }} />
  return <TaskDashboard user={user} token={token} onTokenRefresh={setToken} onLogout={() => void logout()} />
}

export default App