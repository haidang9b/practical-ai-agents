import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Circle, Clock3, Plus, RotateCcw } from 'lucide-react'
import {
  formatDateLong,
  formatMonthTitle,
  formatTime,
  getMonthDates,
  getWeekDates,
  getWeekSummary,
  isValidDateKey,
  shiftDate,
  taskCalendarDate,
  tasksOnDate,
  toDateKey,
  type CalendarView,
  type TaskStatusFilter,
} from '../lib/calendar'
import type { Priority, Task } from '../types/task'

const categories = ['Công việc', 'Cá nhân', 'Học tập', 'Sức khỏe']
const weekdays = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']
const priorities: Priority[] = ['high', 'medium', 'low']

interface CalendarPageProps {
  tasks: Task[]
  onCreate: (dateKey: string) => void
  onEdit: (task: Task) => void
  onMove: (task: Task, dateKey: string) => void
  onToggle: (task: Task) => void
}

function CalendarTask({ task, onEdit, onToggle }: { task: Task; onEdit: (task: Task) => void; onToggle: (task: Task) => void }) {
  const deadlineOverdue = !task.completed && isValidDateKey(task.dueDate) && task.dueDate < toDateKey(new Date())
  const time = formatTime(task.scheduledAt)
  return <article
    className={`calendar-task priority-${task.priority} ${task.completed ? 'is-complete' : ''} ${deadlineOverdue ? 'is-overdue' : ''}`}
    draggable
    onDragStart={(event) => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(task) } }}
    tabIndex={0}
    aria-label={`${task.title}, ${task.completed ? 'đã hoàn thành' : 'chưa hoàn thành'}, ưu tiên ${task.priority}${deadlineOverdue ? ', quá hạn' : ''}`}
  >
    <button className="calendar-task-check" onClick={(event) => { event.stopPropagation(); onToggle(task) }} aria-label={task.completed ? `Đánh dấu chưa hoàn thành: ${task.title}` : `Hoàn thành: ${task.title}`}>
      {task.completed ? <span aria-hidden="true">✓</span> : <Circle size={12} />}
    </button>
    <button className="calendar-task-title" onClick={() => onEdit(task)} title="Mở chi tiết công việc">
      {time && <span className="calendar-task-time">{time}</span>}{task.title}
    </button>
  </article>
}

function CalendarPage({ tasks, onCreate, onEdit, onMove, onToggle }: CalendarPageProps) {
  const [view, setView] = useState<CalendarView>('week')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all')
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const todayKey = toDateKey(new Date())

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (statusFilter === 'active' && task.completed) return false
    if (statusFilter === 'completed' && !task.completed) return false
    if (categoryFilter !== 'all' && task.category !== categoryFilter) return false
    return priorityFilter === 'all' || task.priority === priorityFilter
  }), [tasks, statusFilter, categoryFilter, priorityFilter])

  const dates = view === 'day' ? [new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())]
    : view === 'week' ? getWeekDates(currentDate) : getMonthDates(currentDate)
  const summary = getWeekSummary(filteredTasks, currentDate, todayKey)
  const deadlines = filteredTasks.filter((task) => !task.completed && isValidDateKey(task.dueDate))
  const overdueDeadlines = deadlines.filter((task) => task.dueDate < todayKey).sort((first, second) => second.dueDate.localeCompare(first.dueDate))
  const upcomingDeadlines = deadlines.filter((task) => task.dueDate >= todayKey).sort((first, second) => first.dueDate.localeCompare(second.dueDate))
  const upcoming = [...overdueDeadlines.slice(0, 2), ...upcomingDeadlines.slice(0, 4)]

  const moveTask = (event: React.DragEvent<HTMLElement>, dateKey: string) => {
    event.preventDefault()
    setDragOverKey(null)
    const task = tasks.find((item) => item.id === event.dataTransfer.getData('text/plain'))
    if (!task || !isValidDateKey(dateKey)) return
    const time = formatTime(task.scheduledAt)
    onMove(task, time ? `${dateKey}T${time}` : dateKey)
  }

  const renderDateCell = (date: Date, compact = false) => {
    const dateKey = toDateKey(date)
    const dayTasks = tasksOnDate(filteredTasks, dateKey)
    const today = dateKey === todayKey
    const inCurrentMonth = date.getMonth() === currentDate.getMonth()
    return <div
      className={`calendar-day ${today ? 'is-today' : ''} ${!inCurrentMonth ? 'is-outside' : ''} ${dragOverKey === dateKey ? 'is-drop-target' : ''} ${compact ? 'is-compact' : ''}`}
      data-date={dateKey}
      key={dateKey}
      onDragOver={(event) => { event.preventDefault(); setDragOverKey(dateKey) }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOverKey(null) }}
      onDrop={(event) => moveTask(event, dateKey)}
    >
      <div className="calendar-day-heading">
        <button className="calendar-date-button" onClick={() => onCreate(dateKey)} aria-label={`Tạo công việc ngày ${formatDateLong(date)}`} title="Tạo công việc">
          <span>{view === 'month' ? date.getDate() : new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(date)}</span>
          {view !== 'month' && <strong className={today ? 'today-number' : ''}>{date.getDate()}</strong>}
        </button>
        {today && <span className="today-marker">HÔM NAY</span>}
        <button className="calendar-add" onClick={() => onCreate(dateKey)} aria-label={`Thêm việc ngày ${date.getDate()}`} title="Thêm công việc"><Plus size={14} /></button>
      </div>
      <div className="calendar-day-tasks">
        {dayTasks.map((task) => <CalendarTask key={task.id} task={task} onEdit={onEdit} onToggle={onToggle} />)}
        {dayTasks.length === 0 && view !== 'month' && <button className="calendar-empty-prompt" onClick={() => onCreate(dateKey)}>+ Thêm công việc</button>}
        {view === 'month' && dayTasks.length > 3 && <span className="calendar-more">+{dayTasks.length - 3} việc khác</span>}
      </div>
    </div>
  }

  return <section className="calendar-page" aria-label="Lịch và kế hoạch tuần">
    <div className="calendar-toolbar">
      <div className="calendar-navigation">
        <button className="calendar-icon-button" onClick={() => setCurrentDate((date) => shiftDate(date, view, -1))} aria-label="Khoảng thời gian trước"><ChevronLeft size={17} /></button>
        <button className="calendar-icon-button" onClick={() => setCurrentDate((date) => shiftDate(date, view, 1))} aria-label="Khoảng thời gian sau"><ChevronRight size={17} /></button>
        <button className="calendar-today-button" onClick={() => setCurrentDate(new Date())}><RotateCcw size={13} />Hôm nay</button>
        <h2 aria-live="polite">{view === 'day' ? formatDateLong(currentDate) : formatMonthTitle(currentDate)}</h2>
      </div>
      <div className="calendar-view-switch" role="group" aria-label="Chế độ lịch">
        {(['day', 'week', 'month'] as const).map((item) => <button key={item} className={view === item ? 'selected' : ''} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'day' ? 'Ngày' : item === 'week' ? 'Tuần' : 'Tháng'}</button>)}
      </div>
    </div>

    <div className="calendar-filters" aria-label="Bộ lọc công việc">
      <label>Trạng thái<select aria-label="Lọc trạng thái" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TaskStatusFilter)}><option value="all">Tất cả</option><option value="active">Đang làm</option><option value="completed">Hoàn thành</option></select></label>
      <label>Nhóm<select aria-label="Lọc nhóm" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Tất cả nhóm</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>Ưu tiên<select aria-label="Lọc ưu tiên" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as Priority | 'all')}><option value="all">Tất cả</option>{priorities.map((priority) => <option key={priority} value={priority}>{priority === 'high' ? 'Cao' : priority === 'medium' ? 'Vừa' : 'Thấp'}</option>)}</select></label>
      <span className="calendar-filter-count">{filteredTasks.length} công việc</span>
    </div>

    <div className="calendar-layout">
      <div className={`calendar-board view-${view}`}>
        {view === 'month' && <div className="calendar-weekday-row">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>}
        {view !== 'month' && <div className={`calendar-weekday-row ${view === 'day' ? 'single-weekday' : ''}`}>{dates.map((date) => <span key={toDateKey(date)}>{weekdays[(date.getDay() + 6) % 7]}</span>)}</div>}
        <div className={`calendar-grid ${view === 'month' ? 'month-grid' : view === 'day' ? 'day-grid' : 'week-grid'}`}>
          {dates.map((date) => renderDateCell(date, view === 'month'))}
        </div>
      </div>

      <aside className="calendar-aside" aria-label="Tổng quan lịch">
        <section className="week-summary">
          <div className="calendar-aside-heading"><CalendarDays size={16} /><h3>Kế hoạch tuần</h3></div>
          <div className="week-summary-grid"><div><strong>{summary.completed}</strong><span>Hoàn thành</span></div><div><strong>{summary.remaining}</strong><span>Còn lại</span></div><div className="summary-overdue"><strong>{summary.overdue}</strong><span>Quá hạn</span></div></div>
          <p>{formatDateLong(getWeekDates(currentDate)[0])} - {new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(getWeekDates(currentDate)[6])}</p>
        </section>
        <section className="upcoming-deadlines">
          <div className="calendar-aside-heading"><Clock3 size={16} /><h3>Hạn sắp tới</h3></div>
          {upcoming.length ? upcoming.map((task) => {
            const overdue = task.dueDate < todayKey
            return <button key={task.id} className={`deadline-item ${overdue ? 'is-overdue' : task.dueDate === todayKey ? 'is-due-today' : ''}`} onClick={() => onEdit(task)}>
              <span className="deadline-priority" data-priority={task.priority} />
              <span className="deadline-copy"><strong>{task.title}</strong><small>{task.category}</small></span>
              <time>{overdue ? 'Quá hạn' : task.dueDate === todayKey ? 'Hôm nay' : new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(new Date(`${task.dueDate}T00:00:00`))}</time>
            </button>
          }) : <p className="calendar-aside-empty">Chưa có hạn cần theo dõi.</p>}
        </section>
        <button className="calendar-create-button" onClick={() => onCreate(toDateKey(currentDate))}><Plus size={15} />Tạo công việc</button>
      </aside>
    </div>
    {filteredTasks.every((task) => taskCalendarDate(task) === null) && <p className="calendar-unplaced-note">Công việc chưa có ngày được giữ nguyên trong danh sách và không xuất hiện trên lịch.</p>}
  </section>
}

export default CalendarPage