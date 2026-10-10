import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownUp,
  Activity,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  Columns3,
  ClipboardList,
  Clock3,
  Command,
  ListFilter,
  LogOut,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sun,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { loadTasks, loadTheme, saveTasks, taskStorageKey, THEME_KEY } from './lib/taskStorage';
import AuthScreen from './components/AuthScreen';
import CalendarView from './components/CalendarView';
import KanbanBoard from './components/KanbanBoard';
import ProjectsPage from './components/ProjectsPage';
import AnalyticsPage from './components/AnalyticsPage';
import HabitTrackerPage from './components/HabitTrackerPage';
import SubtaskList from './components/SubtaskList';
import { refreshSession, restoreSession, signOut, type AuthSession, type AuthUser } from './lib/authApi';
import { apiRequest, setAccessToken } from './lib/api';
import { moveTaskToDate } from './lib/calendar';
import type { BoardStatus, Priority, Project, Task, TaskDraft, TaskSort, TaskStatus } from './types';

const emptyDraft: TaskDraft = {
  title: '',
  description: '',
  category: 'Công việc',
  priority: 'medium',
  dueDate: '',
  scheduledAt: '',
  project: 'Công việc',
  projectId: '',
  tags: [],
};

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const priorityLabel: Record<Priority, string> = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };

function dateLabel(date: string): string {
  if (!date) return 'Chưa đặt hạn';
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return 'Quá hạn';
  if (date === today) return 'Hôm nay';
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

interface TodoWorkspaceProps {
  user: AuthUser;
  onLogout: () => void;
}

export function TodoWorkspace({ user, onLogout }: TodoWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks(user.id));
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [status, setStatus] = useState<TaskStatus>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Tất cả');
  const [sort, setSort] = useState<TaskSort>('due');
  const [workspaceView, setWorkspaceView] = useState<'tasks' | 'board' | 'calendar' | 'projects' | 'analytics' | 'habits'>('tasks');
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [tagsInput, setTagsInput] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest<{ tasks: Task[] }>('/tasks').then(async ({ tasks: savedTasks }) => {
      if (!active) return;
      if (savedTasks.length === 0) {
        const legacy = localStorage.getItem(taskStorageKey(user.id));
        const localTasks = loadTasks(user.id);
        if (legacy !== null || localTasks.length > 0) {
          await apiRequest('/tasks/import', { method: 'POST', body: JSON.stringify({ tasks: localTasks }) });
          if (active) setTasks(localTasks);
          return;
        }
      }
      setTasks(savedTasks);
    }).catch((reason: unknown) => {
      if (active) setSyncError(reason instanceof Error ? reason.message : 'Chưa thể đồng bộ dữ liệu với máy chủ.');
    });
    return () => { active = false; };
  }, [user.id]);

  useEffect(() => {
    let active = true;
    apiRequest<{ projects: Project[] }>('/projects').then(({ projects: savedProjects }) => {
      if (active) setProjects(savedProjects);
    }).catch((reason: unknown) => {
      if (active) setSyncError(reason instanceof Error ? reason.message : 'Chưa thể tải dự án.');
    });
    return () => { active = false; };
  }, [user.id]);

  useEffect(() => {
    saveTasks(tasks, user.id);
  }, [tasks, user.id]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const categories = useMemo(
    () => ['Công việc', 'Cá nhân', 'Học tập', ...new Set(tasks.map((task) => task.category))].filter(
      (item, index, all) => all.indexOf(item) === index,
    ),
    [tasks],
  );

  const counts = useMemo(
    () => ({ all: tasks.length, open: tasks.filter((task) => !task.completed).length, done: tasks.filter((task) => task.completed).length }),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi');
    return tasks
      .filter((task) => status === 'all' || (status === 'done' ? task.completed : !task.completed))
      .filter((task) => category === 'Tất cả' || task.category === category)
      .filter((task) => projectFilter === 'all' || (projectFilter === 'unassigned' ? !task.projectId : task.projectId === projectFilter))
      .filter((task) => !normalizedQuery || `${task.title} ${task.description} ${task.category}`.toLocaleLowerCase('vi').includes(normalizedQuery))
      .sort((first, second) => {
        if (sort === 'priority') return priorityRank[first.priority] - priorityRank[second.priority];
        if (sort === 'recent') return second.createdAt.localeCompare(first.createdAt);
        if (!first.dueDate) return second.dueDate ? 1 : 0;
        if (!second.dueDate) return -1;
        return first.dueDate.localeCompare(second.dueDate);
      });
  }, [tasks, status, category, projectFilter, query, sort]);

  const completion = tasks.length ? Math.round((counts.done / tasks.length) * 100) : 0;
  const today = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  function openCreateForm(scheduledAt = '') {
    setEditingTask(null);
    setDraft({ ...emptyDraft, scheduledAt });
    setTagsInput('');
    setFormOpen(true);
  }

  function openEditForm(task: Task) {
    setEditingTask(task);
    setDraft({ title: task.title, description: task.description, category: task.category, priority: task.priority, dueDate: task.dueDate, scheduledAt: task.scheduledAt ?? '', project: task.project, projectId: task.projectId ?? '', tags: task.tags });
    setTagsInput(task.tags.join(', '));
    setFormOpen(true);
  }

  async function persistTask(task: Task, method: 'POST' | 'PATCH') {
    try {
      await apiRequest(method === 'POST' ? '/tasks' : `/tasks/${encodeURIComponent(task.id)}`, {
        method,
        body: JSON.stringify({ ...task, projectId: task.projectId || null }),
      });
      setSyncError('');
      const { projects: savedProjects } = await apiRequest<{ projects: Project[] }>('/projects');
      setProjects(savedProjects);
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : 'Chưa thể lưu thay đổi lên máy chủ.');
    }
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    const tags = [...new Set(tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean))];
    const selectedProject = projects.find((project) => project.id === draft.projectId);
    if (editingTask) {
      const updated = { ...editingTask, ...draft, title, tags, project: selectedProject?.name ?? draft.project, projectId: draft.projectId || null };
      setTasks((current) => current.map((task) => task.id === editingTask.id ? updated : task));
      void persistTask(updated, 'PATCH');
    } else {
      const created: Task = { ...draft, title, tags, project: selectedProject?.name ?? draft.project, projectId: draft.projectId || null, id: crypto.randomUUID(), status: 'todo', completed: false, createdAt: new Date().toISOString() };
      setTasks((current) => [created, ...current]);
      void persistTask(created, 'POST');
    }
    setFormOpen(false);
  }

  function toggleTask(id: string) {
    const changed = tasks.find((task) => task.id === id);
    if (!changed) return;
    const updated = { ...changed, status: changed.completed ? 'todo' : 'done', completed: !changed.completed } as Task;
    setTasks((current) => current.map((task) => task.id === id ? updated : task));
    void persistTask(updated, 'PATCH');
  }

  function moveTask(id: string, nextStatus: BoardStatus) {
    const changed = tasks.find((task) => task.id === id);
    if (!changed) return;
    const updated = { ...changed, status: nextStatus, completed: nextStatus === 'done' };
    setTasks((current) => current.map((task) => task.id === id ? updated : task));
    void persistTask(updated, 'PATCH');
  }

  function deleteTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
    void apiRequest<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((reason: unknown) => setSyncError(reason instanceof Error ? reason.message : 'Chưa thể xóa công việc.'));
  }

  function rescheduleTask(id: string, date: string) {
    const changed = tasks.find((task) => task.id === id);
    if (!changed) return;
    const updated = moveTaskToDate(changed, date);
    setTasks((current) => current.map((task) => task.id === id ? updated : task));
    void persistTask(updated, 'PATCH');
  }

  async function reloadProjects() {
    const { projects: savedProjects } = await apiRequest<{ projects: Project[] }>('/projects');
    setProjects(savedProjects);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Việc Nhỏ, trang chủ">
          <span className="brand-mark"><CheckCheck size={19} strokeWidth={2.2} /></span>
          <span>việc nhỏ<span className="brand-period">.</span></span>
        </a>

        <div className="workspace-label">KHÔNG GIAN CỦA BẠN</div>
        <nav className="primary-nav" aria-label="Không gian công việc">
          <button aria-label="Tất cả công việc" className={`nav-item ${workspaceView === 'tasks' && status === 'all' ? 'is-active' : ''}`} onClick={() => { setWorkspaceView('tasks'); setStatus('all'); }}>
            <ClipboardList size={17} /><span>Tất cả công việc</span><span className="nav-count">{counts.all}</span>
          </button>
          <button aria-label="Bảng Kanban" className={`nav-item ${workspaceView === 'board' ? 'is-active' : ''}`} onClick={() => setWorkspaceView('board')}>
            <Columns3 size={17} /><span>Bảng Kanban</span><span className="nav-count">{counts.open}</span>
          </button>
          <button className={`nav-item ${workspaceView === 'tasks' && status === 'open' ? 'is-active' : ''}`} onClick={() => { setWorkspaceView('tasks'); setStatus('open'); }}>
            <Circle size={17} /><span>Đang thực hiện</span><span className="nav-count">{counts.open}</span>
          </button>
          <button className={`nav-item ${workspaceView === 'tasks' && status === 'done' ? 'is-active' : ''}`} onClick={() => { setWorkspaceView('tasks'); setStatus('done'); }}>
            <Check size={17} /><span>Đã hoàn thành</span><span className="nav-count">{counts.done}</span>
          </button>
          <button aria-label="Lịch & kế hoạch" className={`nav-item ${workspaceView === 'calendar' ? 'is-active' : ''}`} onClick={() => setWorkspaceView('calendar')}>
            <CalendarDays size={17} /><span>Lịch & kế hoạch</span>
          </button>
          <button aria-label="Theo dõi thói quen" className={`nav-item ${workspaceView === 'habits' ? 'is-active' : ''}`} onClick={() => setWorkspaceView('habits')}>
            <Sparkles size={17} /><span>Thói quen</span>
          </button>
          <button aria-label="Quản lý dự án" className={`nav-item ${workspaceView === 'projects' ? 'is-active' : ''}`} onClick={() => setWorkspaceView('projects')}>
            <ClipboardList size={17} /><span>Dự án</span><span className="nav-count">{projects.filter((project) => !project.archived).length}</span>
          </button>
          <button aria-label="Phân tích năng suất" className={`nav-item ${workspaceView === 'analytics' ? 'is-active' : ''}`} onClick={() => setWorkspaceView('analytics')}>
            <Activity size={17} /><span>Phân tích</span>
          </button>
        </nav>

        <div className="sidebar-divider" />
        <div className="workspace-label category-heading"><span>NHÓM CÔNG VIỆC</span><Tag size={14} /></div>
        <nav className="category-nav" aria-label="Lọc theo nhóm">
          <button className={`category-item ${category === 'Tất cả' ? 'is-selected' : ''}`} onClick={() => setCategory('Tất cả')}>
            <span className="category-dot dot-all" />Tất cả nhóm
          </button>
          {categories.map((item, index) => (
            <button className={`category-item ${category === item ? 'is-selected' : ''}`} key={item} onClick={() => setCategory(item)}>
              <span className={`category-dot dot-${index % 3}`} />{item}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="focus-note">
            <div className="focus-note-icon"><Command size={15} /></div>
            <p>Mỗi việc nhỏ<br />đều đáng để bắt đầu.</p>
            <span>Hôm nay là một ngày mới.</span>
          </div>
          <button className="theme-toggle" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Bật giao diện tối' : 'Bật giao diện sáng'}>
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            <span>Giao diện {theme === 'light' ? 'sáng' : 'tối'}</span>
            <span className="theme-status" />
          </button>
        </div>
      </aside>

      <main className="main-content" id="home">
        <header className="topbar">
          <div className="breadcrumb"><span>Không gian</span><span className="breadcrumb-slash">/</span><strong>{workspaceView === 'analytics' ? 'Phân tích' : workspaceView === 'habits' ? 'Thói quen' : workspaceView === 'calendar' ? 'Lịch & kế hoạch' : workspaceView === 'board' ? 'Bảng Kanban' : workspaceView === 'projects' ? 'Dự án' : 'Công việc'}</strong></div>
          <div className="topbar-tools">
            <div className="topbar-date"><CalendarDays size={15} />{today}</div>
            <span className="user-email" title={user.email}>{user.email}</span>
            <button className="logout-button" onClick={onLogout} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={16} /></button>
          </div>
        </header>

        {syncError && <p className="sync-error" role="status">{syncError}</p>}

        <section className="page-intro">
          <div>
            <p className="eyebrow">THỨ TỰ TỪ NHỮNG ĐIỀU NHỎ</p>
            <h1>{workspaceView === 'analytics' ? 'Nhịp làm việc' : workspaceView === 'habits' ? 'Nhịp quen mỗi ngày' : workspaceView === 'calendar' ? 'Lịch của bạn' : workspaceView === 'board' ? 'Bảng công việc' : workspaceView === 'projects' ? 'Dự án của bạn' : 'Việc của bạn'}<span className="heading-mark">.</span></h1>
              <p className="intro-copy">{workspaceView === 'analytics' ? 'Nhìn lại tiến độ, thời gian tập trung và những ngày bạn đã giữ nhịp.' : workspaceView === 'habits' ? 'Gieo một thói quen nhỏ, rồi để những ngày nối tiếp nhau.' : workspaceView === 'calendar' ? 'Nhìn rõ tuần này, dành chỗ cho điều quan trọng.' : workspaceView === 'board' ? 'Theo dõi tiến độ qua từng trạng thái.' : workspaceView === 'projects' ? 'Nhóm công việc và theo dõi từng chặng tiến độ.' : 'Một chút rõ ràng cho ngày thêm nhẹ nhàng.'}</p>
          </div>
          {workspaceView !== 'projects' && workspaceView !== 'analytics' && workspaceView !== 'habits' && <button className="primary-button" onClick={() => openCreateForm()}><Plus size={17} strokeWidth={2.5} /><span>Thêm công việc</span></button>}
        </section>

        {workspaceView === 'tasks' && <section className="stats-grid" aria-label="Thống kê công việc">
          <article className="stat-block stat-total">
            <div className="stat-topline"><span>Tổng công việc</span><span className="stat-icon"><ClipboardList size={16} /></span></div>
            <div className="stat-value">{counts.all}<span>việc</span></div>
            <div className="stat-foot">Trong danh sách của bạn</div>
          </article>
          <article className="stat-block stat-open">
            <div className="stat-topline"><span>Đang thực hiện</span><span className="stat-icon"><Clock3 size={16} /></span></div>
            <div className="stat-value">{counts.open}<span>việc</span></div>
            <div className="stat-foot">Vẫn còn chờ bạn bắt đầu</div>
          </article>
          <article className="stat-block stat-done">
            <div className="stat-topline"><span>Tiến độ hoàn thành</span><span className="stat-icon"><CheckCheck size={16} /></span></div>
            <div className="stat-value">{completion}<span>%</span></div>
            <div className="progress-track" aria-label={`Hoàn thành ${completion}%`}><span style={{ width: `${completion}%` }} /></div>
          </article>
        </section>}

        {workspaceView === 'habits' ? <HabitTrackerPage /> : workspaceView === 'analytics' ? <AnalyticsPage userId={user.id} projects={projects} tasks={tasks} /> : workspaceView === 'projects' ? <ProjectsPage projects={projects} onProjectsChange={() => { void reloadProjects().catch((reason: unknown) => setSyncError(reason instanceof Error ? reason.message : 'Không thể tải lại dự án.')); }} onEditTask={(task) => { setWorkspaceView('tasks'); openEditForm(task); }} /> : workspaceView === 'calendar' ? (
          <CalendarView tasks={tasks} categories={categories} onCreate={openCreateForm} onEdit={openEditForm} onReschedule={rescheduleTask} />
        ) : workspaceView === 'board' ? <KanbanBoard tasks={tasks} onCreate={() => openCreateForm()} onEdit={openEditForm} onDelete={deleteTask} onMove={moveTask} /> : <section className="task-section">
          <div className="section-heading">
            <div>
              <div className="section-title-row"><h2>{status === 'done' ? 'Đã hoàn thành' : status === 'open' ? 'Đang thực hiện' : 'Danh sách công việc'}</h2><span className="result-count">{visibleTasks.length}</span></div>
              <p>Những điều bạn muốn hoàn thành hôm nay.</p>
            </div>
            <button className="filter-action" onClick={() => setSort((value) => value === 'due' ? 'priority' : value === 'priority' ? 'recent' : 'due')} title="Đổi cách sắp xếp">
              <ArrowDownUp size={16} /><span>{sort === 'due' ? 'Theo hạn' : sort === 'priority' ? 'Theo ưu tiên' : 'Mới nhất'}</span><ChevronDown size={14} />
            </button>
          </div>

          <div className="toolbar">
            <label className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong danh sách..." aria-label="Tìm công việc" />
              {query && <button className="clear-search" aria-label="Xóa nội dung tìm kiếm" onClick={() => setQuery('')}><X size={14} /></button>}
            </label>
            <label className="category-select-wrap"><ListFilter size={15} /><select aria-label="Lọc theo nhóm" value={category} onChange={(event) => setCategory(event.target.value)}><option>Tất cả</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
            <label className="project-filter-wrap"><span className="sr-only">Lọc theo dự án</span><select aria-label="Lọc theo dự án" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">Mọi dự án</option><option value="unassigned">Chưa phân loại</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          </div>

          <div className="task-list" aria-live="polite">
            {visibleTasks.map((task, index) => (
              <article className={`task-row ${task.completed ? 'is-complete' : ''}`} key={task.id} style={{ animationDelay: `${Math.min(index * 45, 225)}ms` }}>
                <button className="completion-button" onClick={() => toggleTask(task.id)} aria-label={task.completed ? `Đánh dấu chưa xong: ${task.title}` : `Hoàn thành: ${task.title}`}>
                  {task.completed ? <span className="checked-circle"><Check size={13} /></span> : <span className="unchecked-circle" />}
                </button>
                <div className="task-main">
                  <button className="task-title" onClick={() => openEditForm(task)}>{task.title}</button>
                  {task.description && <p className="task-description">{task.description}</p>}
                  <div className="task-meta">
                    <span className={`priority-pill priority-${task.priority}`}><span />{priorityLabel[task.priority]}</span>
                    <span className="meta-separator" />
                    <span className="task-category">{task.category}</span>
                  </div>
                </div>
                <div className={`task-due ${!task.dueDate ? 'no-date' : task.dueDate < new Date().toISOString().slice(0, 10) && !task.completed ? 'is-overdue' : ''}`}>
                  <CalendarDays size={14} /><span className="task-date-stack"><span>{dateLabel(task.dueDate)}</span>{task.scheduledAt && <small>Đã lên lịch {dateLabel(task.scheduledAt.slice(0, 10))}{task.scheduledAt.includes('T') ? `, ${task.scheduledAt.slice(11, 16)}` : ''}</small>}</span>
                </div>
                <div className="task-actions">
                  <button className="icon-button" onClick={() => openEditForm(task)} aria-label={`Sửa: ${task.title}`} title="Chỉnh sửa"><Pencil size={15} /></button>
                  <button className="icon-button delete-button" onClick={() => deleteTask(task.id)} aria-label={`Xóa: ${task.title}`} title="Xóa"><Trash2 size={15} /></button>
                </div>
                <button className="mobile-more" onClick={() => openEditForm(task)} aria-label={`Tùy chọn: ${task.title}`}><MoreHorizontal size={17} /></button>
              </article>
            ))}
            {visibleTasks.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon"><ClipboardList size={22} /></span>
                <h3>{query ? 'Không tìm thấy việc phù hợp' : 'Danh sách đang trống'}</h3>
                <p>{query ? 'Thử một từ khóa khác hoặc xóa bộ lọc.' : 'Thêm một việc nhỏ để bắt đầu ngày mới.'}</p>
                {!query && <button className="text-button" onClick={() => openCreateForm()}><Plus size={15} />Tạo công việc đầu tiên</button>}
              </div>
            )}
          </div>
          <div className="list-footer"><span><span className="footer-dot" />Đồng bộ với SQLite</span><span>{visibleTasks.length} / {tasks.length} công việc</span></div>
        </section>}

        <footer className="page-footer"><span>VIỆC NHỎ, NGÀY DÀI</span><span>Được tạo để bạn tập trung vào điều quan trọng.</span></footer>
      </main>

      {formOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false); }}>
          <section className="task-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div className="dialog-heading">
              <div><span className="eyebrow">MỘT ĐIỀU CẦN LÀM</span><h2 id="dialog-title">{editingTask ? 'Chỉnh sửa công việc' : 'Thêm công việc mới'}</h2></div>
              <button className="icon-button dialog-close" onClick={() => setFormOpen(false)} aria-label="Đóng"><X size={18} /></button>
            </div>
            <form onSubmit={submitTask}>
              <label className="form-label" htmlFor="task-title">Tên công việc <span>*</span></label>
              <input id="task-title" className="form-control title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ví dụ: Chuẩn bị bài thuyết trình" required autoFocus />
              <label className="form-label" htmlFor="task-description">Mô tả <small>Không bắt buộc</small></label>
              <textarea id="task-description" className="form-control description-input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Thêm vài chi tiết để bạn dễ bắt đầu..." rows={3} />
              <div className="form-grid">
                <div><label className="form-label" htmlFor="task-category">Nhóm</label><input id="task-category" className="form-control" list="category-options" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /><datalist id="category-options">{categories.map((item) => <option key={item} value={item} />)}</datalist></div>
                <div><label className="form-label" htmlFor="task-priority">Mức ưu tiên</label><select id="task-priority" className="form-control" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}><option value="low">Thấp</option><option value="medium">Vừa</option><option value="high">Cao</option></select></div>
              </div>
              <div className="form-grid">
                <div><label className="form-label" htmlFor="task-project">Dự án</label><input id="task-project" className="form-control" list="project-options" value={draft.project} onChange={(event) => setDraft({ ...draft, project: event.target.value })} /><datalist id="project-options">{[...new Set(tasks.map((task) => task.project))].map((project) => <option key={project} value={project} />)}</datalist></div>
                <div><label className="form-label" htmlFor="task-tags">Thẻ <small>Phân cách bằng dấu phẩy</small></label><input id="task-tags" className="form-control" value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="Ví dụ: thiết kế, gấp" /></div>
              </div>
              <label className="form-label" htmlFor="task-project-id">Gắn vào dự án</label>
              <select id="task-project-id" className="form-control" value={draft.projectId ?? ''} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
                <option value="">Chưa phân loại</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <label className="form-label" htmlFor="task-date">Hạn hoàn thành</label>
              <input id="task-date" className="form-control date-control" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
              <label className="form-label" htmlFor="task-scheduled-date">Ngày lên lịch <small>Không bắt buộc</small></label>
              <div className="scheduled-inputs">
                <input id="task-scheduled-date" className="form-control" type="date" aria-label="Ngày lên lịch" value={draft.scheduledAt.slice(0, 10)} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value ? `${event.target.value}${draft.scheduledAt.includes('T') ? draft.scheduledAt.slice(10) : ''}` : '' })} />
                <input className="form-control scheduled-time" type="time" aria-label="Giờ bắt đầu" value={draft.scheduledAt.includes('T') ? draft.scheduledAt.slice(11, 16) : ''} disabled={!draft.scheduledAt.slice(0, 10)} onChange={(event) => { const date = draft.scheduledAt.slice(0, 10) || new Date().toISOString().slice(0, 10); setDraft({ ...draft, scheduledAt: event.target.value ? `${date}T${event.target.value}` : date }); }} />
              </div>
              {editingTask && <SubtaskList taskId={editingTask.id} />}
              <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Hủy</button><button className="primary-button" type="submit"><Check size={16} />{editingTask ? 'Lưu thay đổi' : 'Tạo công việc'}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((savedSession) => { if (active) { setAccessToken(savedSession.accessToken); setSession(savedSession); } })
      .catch(() => { if (active) setSession(null); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    setAccessToken(session.accessToken);
    const timer = window.setInterval(() => {
      refreshSession().then((nextSession) => { setAccessToken(nextSession.accessToken); setSession(nextSession); }).catch(() => { setAccessToken(''); setSession(null); });
    }, 12 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  async function logout() {
    try {
      await signOut();
    } finally {
      setAccessToken('');
      setSession(null);
    }
  }

  function acceptSession(nextSession: AuthSession) {
    setAccessToken(nextSession.accessToken);
    setSession(nextSession);
  }

  if (!ready) {
    return <main className="auth-loading"><span className="brand-mark"><CheckCheck size={19} /></span><p>Đang mở không gian của bạn...</p></main>;
  }

  return session
    ? <TodoWorkspace key={session.user.id} user={session.user} onLogout={logout} />
    : <AuthScreen onAuthenticated={acceptSession} />;
}