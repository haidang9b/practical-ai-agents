import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus } from 'lucide-react';
import type { Priority, Task } from '../types';
import { calendarDateForTask, formatDateKey, getMonthDays, getWeekDays, getWeekStatistics, isCalendarDate, shiftDate } from '../lib/calendar';

type CalendarMode = 'day' | 'week' | 'month';
type CalendarStatus = 'all' | 'open' | 'done';

interface CalendarViewProps {
  tasks: Task[];
  categories: string[];
  onCreate: (date: string) => void;
  onEdit: (task: Task) => void;
  onReschedule: (id: string, date: string) => void;
}

const weekdayLabels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const priorityLabels: Record<Priority, string> = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };

function taskTime(task: Task): string {
  const value = task.scheduledAt ?? '';
  const match = value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/);
  return match?.[1] ?? '';
}

function shortDate(value: string): string {
  if (!isCalendarDate(value)) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
}

export default function CalendarView({ tasks, categories, onCreate, onEdit, onReschedule }: CalendarViewProps) {
  const [mode, setMode] = useState<CalendarMode>('week');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [status, setStatus] = useState<CalendarStatus>('all');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const today = formatDateKey(new Date());
  const dayDates = useMemo(() => mode === 'day' ? [selectedDate] : mode === 'week' ? getWeekDays(selectedDate) : getMonthDays(selectedDate), [mode, selectedDate]);
  const filteredTasks = useMemo(() => tasks.filter((task) =>
    (status === 'all' || (status === 'done' ? task.completed : !task.completed))
    && (category === 'all' || task.category === category)
    && (priority === 'all' || task.priority === priority),
  ), [tasks, status, category, priority]);
  const tasksByDate = useMemo(() => {
    const result = new Map<string, Task[]>();
    for (const task of filteredTasks) {
      const date = calendarDateForTask(task);
      if (!date) continue;
      result.set(date, [...(result.get(date) ?? []), task]);
    }
    for (const dayTasks of result.values()) {
      dayTasks.sort((first, second) => taskTime(first).localeCompare(taskTime(second)) || first.title.localeCompare(second.title));
    }
    return result;
  }, [filteredTasks]);
  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
  const statistics = useMemo(() => getWeekStatistics(filteredTasks, weekDays, today), [filteredTasks, weekDays, today]);
  const unplannedTasks = filteredTasks.filter((task) => !calendarDateForTask(task));
  const upcomingDeadlines = filteredTasks
    .filter((task) => !task.completed && isCalendarDate(task.dueDate) && task.dueDate <= formatDateKey(shiftDate(new Date(), 7)))
    .sort((first, second) => {
      const firstOverdue = first.dueDate < today;
      const secondOverdue = second.dueDate < today;
      if (firstOverdue !== secondOverdue) return firstOverdue ? -1 : 1;
      return firstOverdue ? second.dueDate.localeCompare(first.dueDate) : first.dueDate.localeCompare(second.dueDate);
    })
    .slice(0, 5);
  const rangeLabel = mode === 'day'
    ? new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(selectedDate)
    : mode === 'month'
      ? new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(selectedDate)
      : `${shortDate(formatDateKey(dayDates[0]))} – ${shortDate(formatDateKey(dayDates[6]))} ${selectedDate.getFullYear()}`;

  function navigate(amount: number) {
    if (mode === 'day') setSelectedDate((date) => shiftDate(date, amount));
    else if (mode === 'week') setSelectedDate((date) => shiftDate(date, amount * 7));
    else setSelectedDate((date) => new Date(date.getFullYear(), date.getMonth() + amount, 1));
  }

  function dropTask(event: React.DragEvent<HTMLElement>, date: string) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    if (taskId && isCalendarDate(date)) onReschedule(taskId, date);
  }

  function renderTask(task: Task) {
    const deadlineState = !task.completed && task.dueDate && task.dueDate < today ? ' is-overdue' : task.dueDate === today && !task.completed ? ' is-due-today' : '';
    return (
      <article
        className={`calendar-task priority-${task.priority}${task.completed ? ' is-complete' : ''}${deadlineState}`}
        key={task.id}
        draggable
        onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
      >
        <button className="calendar-task-main" onClick={() => onEdit(task)} aria-label={`Mở công việc: ${task.title}`}>
          <span className="calendar-task-title">{task.title}</span>
          <span className="calendar-task-meta">
            {taskTime(task) && <span><Clock3 size={11} />{taskTime(task)}</span>}
            <span>{task.category}</span>
            <span>{priorityLabels[task.priority]}</span>
          </span>
        </button>
        {task.completed && <span className="calendar-complete-mark" aria-label="Đã hoàn thành">✓</span>}
      </article>
    );
  }

  function renderDateCell(date: Date) {
    const dateKey = formatDateKey(date);
    const dayTasks = tasksByDate.get(dateKey) ?? [];
    const isCurrentMonth = date.getMonth() === selectedDate.getMonth();
    return (
      <section
        className={`calendar-cell${dateKey === today ? ' is-today' : ''}${!isCurrentMonth && mode === 'month' ? ' is-outside-month' : ''}`}
        key={dateKey}
        aria-label={new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full' }).format(date)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropTask(event, dateKey)}
      >
        <div className="calendar-cell-heading">
          {mode === 'week' && <span className="calendar-weekday">{new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(date)}</span>}
          <button className="calendar-date-number" aria-label={`Chọn ngày ${dateKey}`} onClick={() => { setSelectedDate(date); if (mode === 'month') setMode('day'); }}>
            <span>{date.getDate()}</span>{dateKey === today && <span className="today-label">Hôm nay</span>}
          </button>
          <button className="calendar-add-day" onClick={() => onCreate(dateKey)} aria-label={`Tạo công việc ngày ${dateKey}`} title="Tạo công việc"><Plus size={15} /></button>
        </div>
        <div className="calendar-cell-tasks">
          {dayTasks.map(renderTask)}
          {dayTasks.length === 0 && mode === 'day' && <p className="calendar-empty-day">Chưa có công việc trong ngày này.</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="calendar-page" aria-label="Lịch và kế hoạch tuần">
      <div className="calendar-toolbar">
        <div className="calendar-navigation" aria-label="Điều hướng lịch">
          <button className="calendar-icon-button" onClick={() => navigate(-1)} aria-label="Khoảng trước"><ChevronLeft size={18} /></button>
          <button className="calendar-icon-button" onClick={() => navigate(1)} aria-label="Khoảng sau"><ChevronRight size={18} /></button>
          <button className="calendar-today-button" onClick={() => setSelectedDate(new Date())}>Hôm nay</button>
          <h2 className="calendar-range" aria-live="polite">{rangeLabel}</h2>
        </div>
        <div className="calendar-view-switch" role="group" aria-label="Chế độ xem lịch">
          {(['day', 'week', 'month'] as const).map((view) => <button key={view} className={mode === view ? 'is-current' : ''} aria-pressed={mode === view} onClick={() => setMode(view)}>{view === 'day' ? 'Ngày' : view === 'week' ? 'Tuần' : 'Tháng'}</button>)}
        </div>
      </div>

      <div className="calendar-filter-row" aria-label="Bộ lọc công việc lịch">
        <label><span>Trạng thái</span><select aria-label="Lọc trạng thái lịch" value={status} onChange={(event) => setStatus(event.target.value as CalendarStatus)}><option value="all">Tất cả</option><option value="open">Đang làm</option><option value="done">Đã xong</option></select></label>
        <label><span>Nhóm</span><select aria-label="Lọc nhóm lịch" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Tất cả nhóm</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Ưu tiên</span><select aria-label="Lọc ưu tiên lịch" value={priority} onChange={(event) => setPriority(event.target.value as Priority | 'all')}><option value="all">Mọi mức</option><option value="high">Cao</option><option value="medium">Vừa</option><option value="low">Thấp</option></select></label>
      </div>

      <div className="weekly-summary" aria-label="Thống kê tuần được chọn">
        <div><strong>{statistics.completed}</strong><span>Đã xong</span></div>
        <div><strong>{statistics.remaining}</strong><span>Còn lại</span></div>
        <div className={statistics.overdue ? 'summary-overdue' : ''}><strong>{statistics.overdue}</strong><span>Quá hạn</span></div>
        <p><CalendarDays size={15} />Kế hoạch tuần</p>
      </div>

      {mode === 'month' && <div className="calendar-weekday-headings" aria-hidden="true">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>}
      <div className={`calendar-scroll calendar-scroll-${mode}`}>
        <div className={`calendar-grid calendar-${mode}`} role="group" aria-label={`Lịch ${mode === 'day' ? 'ngày' : mode === 'week' ? 'tuần' : 'tháng'}`}>
          {dayDates.map(renderDateCell)}
        </div>
      </div>

      <div className="calendar-lower-panels">
        <section className="upcoming-panel" aria-labelledby="upcoming-title">
          <div className="calendar-panel-heading"><div><span className="calendar-panel-kicker">HẠN SẮP TỚI</span><h3 id="upcoming-title">Đừng bỏ lỡ</h3></div><span className="upcoming-count">{upcomingDeadlines.length}</span></div>
          {upcomingDeadlines.length ? <ul className="upcoming-list">{upcomingDeadlines.map((task) => <li key={task.id} className={task.dueDate < today ? 'is-overdue' : task.dueDate === today ? 'is-today' : ''}><button onClick={() => onEdit(task)}><span className="upcoming-date">{task.dueDate < today ? 'Quá hạn' : task.dueDate === today ? 'Hôm nay' : shortDate(task.dueDate)}</span><span className="upcoming-title">{task.title}</span><span className="upcoming-category">{task.category}</span></button></li>)}</ul> : <p className="calendar-panel-empty">Không có hạn hoàn thành trong 7 ngày tới.</p>}
        </section>
        <section className="unplanned-panel" aria-labelledby="unplanned-title">
          <div className="calendar-panel-heading"><div><span className="calendar-panel-kicker">CHƯA LÊN LỊCH</span><h3 id="unplanned-title">Việc cần sắp xếp</h3></div><span className="upcoming-count">{unplannedTasks.length}</span></div>
          {unplannedTasks.length ? <div className="unplanned-list">{unplannedTasks.map(renderTask)}</div> : <p className="calendar-panel-empty">Mọi việc đã có ngày trên lịch.</p>}
        </section>
      </div>
    </section>
  );
}
