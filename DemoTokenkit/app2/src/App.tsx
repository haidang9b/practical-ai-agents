import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownUp,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
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
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { loadTasks, loadTheme, saveTasks, THEME_KEY } from './lib/taskStorage';
import AuthScreen from './components/AuthScreen';
import { refreshSession, restoreSession, signOut, type AuthSession, type AuthUser } from './lib/authApi';
import type { Priority, Task, TaskDraft, TaskSort, TaskStatus } from './types';

const emptyDraft: TaskDraft = {
  title: '',
  description: '',
  category: 'Công việc',
  priority: 'medium',
  dueDate: '',
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
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);

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
      .filter((task) => !normalizedQuery || `${task.title} ${task.description} ${task.category}`.toLocaleLowerCase('vi').includes(normalizedQuery))
      .sort((first, second) => {
        if (sort === 'priority') return priorityRank[first.priority] - priorityRank[second.priority];
        if (sort === 'recent') return second.createdAt.localeCompare(first.createdAt);
        if (!first.dueDate) return second.dueDate ? 1 : 0;
        if (!second.dueDate) return -1;
        return first.dueDate.localeCompare(second.dueDate);
      });
  }, [tasks, status, category, query, sort]);

  const completion = tasks.length ? Math.round((counts.done / tasks.length) * 100) : 0;
  const today = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  function openCreateForm() {
    setEditingTask(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  }

  function openEditForm(task: Task) {
    setEditingTask(task);
    setDraft({ title: task.title, description: task.description, category: task.category, priority: task.priority, dueDate: task.dueDate });
    setFormOpen(true);
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    if (editingTask) {
      setTasks((current) => current.map((task) => task.id === editingTask.id ? { ...task, ...draft, title } : task));
    } else {
      setTasks((current) => [{ ...draft, title, id: crypto.randomUUID(), completed: false, createdAt: new Date().toISOString() }, ...current]);
    }
    setFormOpen(false);
  }

  function toggleTask(id: string) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: !task.completed } : task));
  }

  function deleteTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Việc Nhỏ, trang chủ">
          <span className="brand-mark"><CheckCheck size={19} strokeWidth={2.2} /></span>
          <span>việc nhỏ<span className="brand-period">.</span></span>
        </a>

        <div className="workspace-label">KHÔNG GIAN CỦA BẠN</div>
        <nav className="primary-nav" aria-label="Danh sách công việc">
          <button className={`nav-item ${status === 'all' ? 'is-active' : ''}`} onClick={() => setStatus('all')}>
            <ClipboardList size={17} /><span>Tất cả công việc</span><span className="nav-count">{counts.all}</span>
          </button>
          <button className={`nav-item ${status === 'open' ? 'is-active' : ''}`} onClick={() => setStatus('open')}>
            <Circle size={17} /><span>Đang thực hiện</span><span className="nav-count">{counts.open}</span>
          </button>
          <button className={`nav-item ${status === 'done' ? 'is-active' : ''}`} onClick={() => setStatus('done')}>
            <Check size={17} /><span>Đã hoàn thành</span><span className="nav-count">{counts.done}</span>
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
          <div className="breadcrumb"><span>Không gian</span><span className="breadcrumb-slash">/</span><strong>Công việc</strong></div>
          <div className="topbar-tools">
            <div className="topbar-date"><CalendarDays size={15} />{today}</div>
            <span className="user-email" title={user.email}>{user.email}</span>
            <button className="logout-button" onClick={onLogout} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={16} /></button>
          </div>
        </header>

        <section className="page-intro">
          <div>
            <p className="eyebrow">THỨ TỰ TỪ NHỮNG ĐIỀU NHỎ</p>
            <h1>Việc của bạn<span className="heading-mark">.</span></h1>
            <p className="intro-copy">Một chút rõ ràng cho ngày thêm nhẹ nhàng.</p>
          </div>
          <button className="primary-button" onClick={openCreateForm}><Plus size={17} strokeWidth={2.5} /><span>Thêm công việc</span></button>
        </section>

        <section className="stats-grid" aria-label="Thống kê công việc">
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
        </section>

        <section className="task-section">
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
                  <CalendarDays size={14} /><span>{dateLabel(task.dueDate)}</span>
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
                {!query && <button className="text-button" onClick={openCreateForm}><Plus size={15} />Tạo công việc đầu tiên</button>}
              </div>
            )}
          </div>
          <div className="list-footer"><span><span className="footer-dot" />Đã lưu trên thiết bị này</span><span>{visibleTasks.length} / {tasks.length} công việc</span></div>
        </section>

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
              <label className="form-label" htmlFor="task-date">Hạn hoàn thành</label>
              <input id="task-date" className="form-control date-control" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
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
      .then((savedSession) => { if (active) setSession(savedSession); })
      .catch(() => { if (active) setSession(null); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      refreshSession().then(setSession).catch(() => setSession(null));
    }, 12 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  async function logout() {
    try {
      await signOut();
    } finally {
      setSession(null);
    }
  }

  if (!ready) {
    return <main className="auth-loading"><span className="brand-mark"><CheckCheck size={19} /></span><p>Đang mở không gian của bạn...</p></main>;
  }

  return session
    ? <TodoWorkspace key={session.user.id} user={session.user} onLogout={logout} />
    : <AuthScreen onAuthenticated={setSession} />;
}