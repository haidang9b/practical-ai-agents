import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlarmClock,
  ArrowDownUp,
  Check,
  CheckCheck,
  Circle,
  CircleHelp,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Moon,
  Pencil,
  Plus,
  Search,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { createTask, deleteTask, getTasks, restoreSession, signOut, updateTask, type SessionUser } from './lib/api'
import AuthScreen from './components/AuthScreen'
import { readTheme, saveTheme } from './lib/storage'
import type { Priority, Task, TaskDraft, TaskFilter } from './types/task'

const categories = ['Công việc', 'Cá nhân', 'Học tập', 'Sức khỏe']
const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
const emptyDraft: TaskDraft = {
  title: '',
  description: '',
  category: 'Công việc',
  priority: 'medium',
  dueDate: '',
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
  const [taskError, setTaskError] = useState('')
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [isDark, setIsDark] = useState(readTheme)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'priority' | 'created'>('date')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft)

  useEffect(() => {
    let isCurrent = true
    setIsLoadingTasks(true)
    getTasks(token, onTokenRefresh)
      .then(({ tasks: loadedTasks }) => { if (isCurrent) setTasks(loadedTasks) })
      .catch((error: unknown) => { if (isCurrent) setTaskError(error instanceof Error ? error.message : 'Không thể tải công việc.') })
      .finally(() => { if (isCurrent) setIsLoadingTasks(false) })
    return () => { isCurrent = false }
  }, [token, onTokenRefresh])
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
      return !normalizedQuery || `${task.title} ${task.description} ${task.category}`.toLocaleLowerCase('vi').includes(normalizedQuery)
    })

    return filtered.sort((first, second) => {
      if (sortBy === 'priority') return priorityRank[first.priority] - priorityRank[second.priority]
      if (sortBy === 'created') return second.createdAt.localeCompare(first.createdAt)
      if (!first.dueDate) return 1
      if (!second.dueDate) return -1
      return first.dueDate.localeCompare(second.dueDate)
    })
  }, [tasks, filter, categoryFilter, query, sortBy, today])

  const openNewTask = () => {
    setEditingTask(null)
    setDraft(emptyDraft)
    setIsFormOpen(true)
  }

  const openEditTask = (task: Task) => {
    setEditingTask(task)
    setDraft({ title: task.title, description: task.description, category: task.category, priority: task.priority, dueDate: task.dueDate })
    setIsFormOpen(true)
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
      } else {
        const { task } = await createTask(token, { ...draft, title }, onTokenRefresh)
        setTasks((current) => [task, ...current])
      }
      setIsFormOpen(false)
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Không thể lưu công việc.')
    }
  }

  const toggleTask = async (task: Task) => {
    try {
      const { task: updatedTask } = await updateTask(token, task.id, { completed: !task.completed }, onTokenRefresh)
      setTasks((current) => current.map((item) => item.id === updatedTask.id ? updatedTask : item))
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Không thể cập nhật công việc.')
    }
  }

  const removeTask = async (task: Task) => {
    try {
      await deleteTask(token, task.id, onTokenRefresh)
      setTasks((current) => current.filter((item) => item.id !== task.id))
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Không thể xóa công việc.')
    }
  }

  const title = categoryFilter ?? ({ all: 'Tất cả công việc', today: 'Việc hôm nay', upcoming: 'Sắp tới', completed: 'Đã hoàn thành' } satisfies Record<TaskFilter, string>)[filter]
  const greetingDate = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  const setView = (nextFilter: TaskFilter) => {
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
          <button className={`nav-item ${filter === 'all' && !categoryFilter ? 'active' : ''}`} onClick={() => setView('all')}>
            <LayoutDashboard size={17} /><span>Tổng quan</span><span className="nav-count">{activeCount}</span>
          </button>
          <button className={`nav-item ${filter === 'today' ? 'active' : ''}`} onClick={() => setView('today')}>
            <ListTodo size={17} /><span>Hôm nay</span><span className="nav-count">{dueTodayCount}</span>
          </button>
          <button className={`nav-item ${filter === 'upcoming' ? 'active' : ''}`} onClick={() => setView('upcoming')}>
            <Clock3 size={17} /><span>Sắp tới</span>
          </button>
          <button className={`nav-item ${filter === 'completed' ? 'active' : ''}`} onClick={() => setView('completed')}>
            <Check size={17} /><span>Đã hoàn thành</span><span className="nav-count">{completedCount}</span>
          </button>
        </nav>

        <div className="side-label category-label">NHÓM CÔNG VIỆC</div>
        <nav className="category-nav" aria-label="Lọc theo nhóm">
          {categories.map((category, index) => (
            <button key={category} className={`category-item ${categoryFilter === category ? 'selected' : ''}`} onClick={() => { setCategoryFilter(category); setFilter('all') }}>
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
              <h1>{filter === 'all' && !categoryFilter ? <>Chào buổi sáng, <span>{user.displayName}.</span></> : title}</h1>
              <p className="welcome-subtitle">{filter === 'all' && !categoryFilter ? 'Một ngày mới, một cơ hội mới để tiến thêm một bước.' : 'Tập trung vào điều quan trọng nhất với bạn.'}</p>
            </div>
            <button className="primary-button" onClick={openNewTask}><Plus size={18} strokeWidth={2.5} /><span>Thêm công việc</span></button>
          </section>

          <section className="stats-grid" aria-label="Thống kê công việc">
            <article className="stat-panel stat-total"><span className="stat-icon"><ClipboardList size={17} /></span><span className="stat-label">ĐANG THỰC HIỆN</span><strong>{activeCount.toString().padStart(2, '0')}</strong><span className="stat-foot">công việc đang chờ bạn</span><span className="stat-decoration">↗</span></article>
            <article className="stat-panel stat-today"><span className="stat-icon"><Clock3 size={17} /></span><span className="stat-label">HẠN HÔM NAY</span><strong>{dueTodayCount.toString().padStart(2, '0')}</strong><span className="stat-foot">việc cần hoàn thành hôm nay</span><span className="stat-decoration">◷</span></article>
            <article className="stat-panel stat-done"><span className="stat-icon"><CheckCheck size={17} /></span><span className="stat-label">ĐÃ HOÀN THÀNH</span><strong>{completedCount.toString().padStart(2, '0')}</strong><span className="stat-foot">bạn đã làm rất tốt!</span><span className="stat-decoration">✳</span></article>
            <article className="stat-panel stat-focus"><span className="stat-icon"><CircleHelp size={17} /></span><span className="stat-label">CẦN ƯU TIÊN</span><strong>{highPriorityCount.toString().padStart(2, '0')}</strong><span className="stat-foot">việc quan trọng cần chú ý</span><span className="stat-decoration">!</span></article>
          </section>

          <section className="task-section">
            <div className="section-heading">
              <div><div className="section-title-line"><h2>{filter === 'all' && !categoryFilter ? 'Danh sách công việc' : title}</h2><span className="task-total">{visibleTasks.length}</span></div><p>Những điều bạn đang tập trung hôm nay</p></div>
              <button className="text-button" onClick={openNewTask}><Plus size={16} /> Tạo mới</button>
            </div>

            <div className="task-toolbar">
              <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm công việc..." aria-label="Tìm công việc" />{query && <button onClick={() => setQuery('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}</label>
              <label className="sort-control"><ArrowDownUp size={15} /><span>Sắp xếp</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} aria-label="Sắp xếp công việc"><option value="date">Ngày đến hạn</option><option value="priority">Độ ưu tiên</option><option value="created">Mới tạo</option></select></label>
            </div>

            {taskError && <p className="task-error" role="alert">{taskError}</p>}
            {isLoadingTasks ? <div className="empty-state"><span className="empty-icon"><ClipboardList size={23} /></span><h3>Đang tải công việc...</h3></div> : visibleTasks.length > 0 ? <div className="task-list" aria-label="Danh sách công việc">
              {visibleTasks.map((task) => <article className={`task-row ${task.completed ? 'is-complete' : ''}`} key={task.id}>
                <button className={`complete-button ${task.completed ? 'checked' : ''}`} onClick={() => void toggleTask(task)} aria-label={task.completed ? `Đánh dấu chưa hoàn thành: ${task.title}` : `Hoàn thành: ${task.title}`}>
                  {task.completed ? <Check size={14} /> : <Circle size={19} strokeWidth={1.6} />}
                </button>
                <div className="task-main"><div className="task-title-line"><h3>{task.title}</h3><span className={`priority-dot priority-${task.priority}`} title={`Ưu tiên ${task.priority}`} /></div>{task.description && <p className="task-description">{task.description}</p>}<div className="task-meta"><span className={`task-category category-${categories.indexOf(task.category) % 4}`}><Tag size={12} />{task.category}</span><span className={`task-due ${!task.completed && task.dueDate && task.dueDate < today ? 'overdue' : ''}`}><Clock3 size={12} />{formatDate(task.dueDate)}</span></div></div>
                <span className={`priority-label label-${task.priority}`}>{task.priority === 'high' ? 'Cao' : task.priority === 'medium' ? 'Vừa' : 'Thấp'}</span>
                <div className="task-actions"><button onClick={() => openEditTask(task)} aria-label={`Chỉnh sửa ${task.title}`} title="Chỉnh sửa"><Pencil size={15} /></button><button onClick={() => void removeTask(task)} aria-label={`Xóa ${task.title}`} title="Xóa"><Trash2 size={15} /></button></div>
              </article>)}
            </div> : <div className="empty-state"><span className="empty-icon"><ClipboardList size={23} /></span><h3>{query ? 'Không tìm thấy công việc' : 'Chưa có công việc nào'}</h3><p>{query ? 'Thử một từ khóa khác nhé.' : 'Thêm việc đầu tiên để bắt đầu ngày mới thật chủ động.'}</p>{!query && <button className="text-button" onClick={openNewTask}><Plus size={16} /> Thêm công việc đầu tiên</button>}</div>}
          </section>
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
            <label className="field-label">Ngày đến hạn <span className="optional-label">KHÔNG BẮT BUỘC</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
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