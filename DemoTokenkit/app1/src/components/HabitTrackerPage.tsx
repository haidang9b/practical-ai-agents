import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Archive, BookOpen, Briefcase, Check, ChevronDown, Circle, Dumbbell, Heart, Leaf, Pencil, Plus, RotateCcw, Sparkles, Trash2, X, type LucideIcon } from 'lucide-react'
import { archiveHabit, createHabit, deleteHabit, getHabitHistory, getHabitSummary, getHabits, setHabitCompletion, updateHabit, type Habit, type HabitDraft, type HabitHistoryDay, type HabitSummary } from '../lib/api'

const categories = ['Sức khỏe', 'Học tập', 'Thể lực', 'Công việc', 'Cá nhân']
const colors = ['#3b8063', '#c27656', '#527f9c', '#a17c39', '#8d6b91', '#4e8983']
const iconOptions: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'sparkles', label: 'Lấp lánh', Icon: Sparkles },
  { id: 'heart', label: 'Trái tim', Icon: Heart },
  { id: 'book-open', label: 'Sách', Icon: BookOpen },
  { id: 'dumbbell', label: 'Tạ', Icon: Dumbbell },
  { id: 'briefcase', label: 'Cặp công việc', Icon: Briefcase },
  { id: 'leaf', label: 'Lá cây', Icon: Leaf },
]
const iconById = Object.fromEntries(iconOptions.map(({ id, Icon }) => [id, Icon])) as Record<string, LucideIcon>

function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftDate(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + amount)
  return localDateString(date)
}

function mondayOf(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return localDateString(date)
}

function timezoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function defaultDraft(): HabitDraft {
  return { name: '', description: '', category: 'Sức khỏe', icon: 'sparkles', color: colors[0], frequency: 'daily', weeklyTarget: 7, startDate: localDateString(), endDate: null }
}

async function loadHabitData(token: string, onTokenRefresh: (token: string) => void) {
  const today = localDateString()
  const timezone = timezoneName()
  const startDate = shiftDate(today, -83)
  const [habitResult, summary, history] = await Promise.all([
    getHabits(token, 'all', onTokenRefresh),
    getHabitSummary(token, timezone, onTokenRefresh),
    getHabitHistory(token, startDate, today, timezone, onTokenRefresh),
  ])
  return { habits: habitResult.habits, summary, days: history.days }
}

interface HabitTrackerPageProps {
  token: string
  onTokenRefresh: (token: string) => void
}

export default function HabitTrackerPage({ token, onTokenRefresh }: HabitTrackerPageProps) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [summary, setSummary] = useState<HabitSummary | null>(null)
  const [history, setHistory] = useState<HabitHistoryDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [historyView, setHistoryView] = useState<'day' | 'week' | 'month'>('day')
  const [selectedDate, setSelectedDate] = useState(localDateString())
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [draft, setDraft] = useState<HabitDraft>(defaultDraft)
  const [saving, setSaving] = useState(false)
  const [pendingKey, setPendingKey] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<Habit | null>(null)

  useEffect(() => {
    let current = true
    setLoading(true)
    loadHabitData(token, onTokenRefresh)
      .then((data) => { if (current) { setHabits(data.habits); setSummary(data.summary); setHistory(data.days); setError('') } })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Không thể tải thói quen.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [token, onTokenRefresh])

  const reload = async () => {
    const data = await loadHabitData(token, onTokenRefresh)
    setHabits(data.habits)
    setSummary(data.summary)
    setHistory(data.days)
  }

  const today = localDateString()
  const mostConsistent = summary?.habits.filter((habit) => !habit.archived).sort((first, second) => second.completionRate - first.completionRate || second.currentStreak - first.currentStreak)[0]
  const visibleHabits = habits.filter((habit) => habit.archived === showArchived && (categoryFilter === 'all' || habit.category === categoryFilter))
  const dayByDate = new Map(history.map((day) => [day.date, day]))
  const selectedCompletions = new Set((dayByDate.get(selectedDate)?.completions ?? []).map((item) => item.habitId))
  const eligibleOnSelectedDate = visibleHabits.filter((habit) => selectedDate >= habit.startDate && (!habit.endDate || selectedDate <= habit.endDate) && (!habit.archivedAt || selectedDate <= habit.archivedAt.slice(0, 10)))
  const leadingCells = history.length ? (new Date(`${history[0].date}T00:00:00`).getDay() + 6) % 7 : 0

  const groupedHistory = (() => {
    if (historyView === 'day') return history.map((day) => ({ key: day.date, label: day.date.slice(5), count: day.count, date: day.date }))
    const groups = new Map<string, { key: string; label: string; count: number; date: string }>()
    for (const day of history) {
      const key = historyView === 'week' ? mondayOf(day.date) : day.date.slice(0, 7)
      const group = groups.get(key) ?? { key, label: historyView === 'week' ? `${key.slice(5)} tuần` : key.slice(5), count: 0, date: day.date }
      group.count += day.count
      group.date = day.date
      groups.set(key, group)
    }
    return [...groups.values()]
  })()
  const chartGroups = historyView === 'day' ? groupedHistory.slice(-14) : groupedHistory
  const chartMaximum = Math.max(1, ...chartGroups.map((group) => group.count))

  const openNew = () => {
    setEditingHabit(null)
    setDraft(defaultDraft())
    setError('')
    setIsFormOpen(true)
  }

  const openEdit = (habit: Habit) => {
    setEditingHabit(habit)
    setDraft({ name: habit.name, description: habit.description, category: habit.category, icon: habit.icon, color: habit.color, frequency: habit.frequency, weeklyTarget: habit.weeklyTarget, startDate: habit.startDate, endDate: habit.endDate })
    setError('')
    setIsFormOpen(true)
  }

  const saveHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const normalizedDraft = { ...draft, name: draft.name.trim(), weeklyTarget: draft.frequency === 'daily' ? 7 : draft.weeklyTarget }
      if (editingHabit) await updateHabit(token, editingHabit.id, normalizedDraft, onTokenRefresh)
      else await createHabit(token, normalizedDraft, onTokenRefresh)
      await reload()
      setIsFormOpen(false)
      setNotice(editingHabit ? 'Đã cập nhật thói quen.' : 'Đã tạo thói quen mới.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể lưu thói quen.')
    } finally {
      setSaving(false)
    }
  }

  const toggleCompletion = async (habit: Habit, date: string, completed: boolean) => {
    const key = `${habit.id}:${date}`
    if (pendingKey) return
    setPendingKey(key)
    setError('')
    setNotice('')
    try {
      await setHabitCompletion(token, habit.id, date, completed, timezoneName(), onTokenRefresh)
      await reload()
      setNotice(completed ? 'Đã ghi nhận hoàn thành.' : 'Đã bỏ ghi nhận hoàn thành.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật tiến độ.')
    } finally {
      setPendingKey('')
    }
  }

  const toggleArchive = async (habit: Habit) => {
    setPendingKey(habit.id)
    setError('')
    try {
      if (habit.archived) await updateHabit(token, habit.id, { archived: false }, onTokenRefresh)
      else await archiveHabit(token, habit.id, onTokenRefresh)
      await reload()
      setNotice(habit.archived ? 'Đã khôi phục thói quen.' : 'Đã lưu thói quen vào mục đã lưu trữ.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật thói quen.')
    } finally {
      setPendingKey('')
    }
  }

  const removeHabit = async () => {
    if (!deleteCandidate) return
    setPendingKey(deleteCandidate.id)
    setError('')
    try {
      await deleteHabit(token, deleteCandidate.id, onTokenRefresh)
      await reload()
      setDeleteCandidate(null)
      setNotice('Đã xóa thói quen và lịch sử của thói quen đó.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa thói quen.')
    } finally {
      setPendingKey('')
    }
  }

  return (
    <section className="habit-page" aria-label="Theo dõi thói quen">
      {error && <p className="task-error" role="alert">{error}</p>}
      {notice && <p className="habit-notice" role="status">{notice}</p>}

      <div className="habit-overview">
        <div className="habit-overview-copy">
          <p className="eyebrow"><span className="eyebrow-line" />NHỊP ĐIỆU CỦA BẠN</p>
          <h2>{summary?.today.completed ?? 0}<span> / {summary?.today.total ?? 0}</span></h2>
          <p>thói quen đã hoàn thành hôm nay</p>
          <div className="habit-overview-track" role="progressbar" aria-label="Tiến độ hôm nay" aria-valuemin={0} aria-valuemax={summary?.today.total ?? 0} aria-valuenow={summary?.today.completed ?? 0}>
            <span style={{ width: `${summary?.today.rate ?? 0}%` }} />
          </div>
        </div>
        <div className="habit-overview-stats">
          <div><span>Tuần này</span><strong>{summary?.week.completed ?? 0}<small> lần</small></strong><small>{summary?.week.startDate ? `Từ ${summary.week.startDate.slice(5)}` : 'Chưa có dữ liệu'}</small></div>
          <div><span>Tháng này</span><strong>{summary?.month.rate ?? 0}<small>%</small></strong><small>{summary?.month.completed ?? 0} lần hoàn thành</small></div>
          <div className="habit-best-habit"><span>Nhịp ổn định nhất</span><strong>{mostConsistent?.name ?? 'Chưa có'}</strong><small>{mostConsistent ? `Hoàn thành ${mostConsistent.completionRate}%` : 'Bắt đầu theo dõi hôm nay'}</small></div>
        </div>
        <button className="habit-add-button" onClick={openNew}><Plus size={17} />Tạo thói quen</button>
      </div>

      <div className="habit-section-heading">
        <div><h2>Hôm nay</h2><p>Một nhịp nhỏ, lặp lại đủ lâu sẽ thành đổi thay.</p></div>
        <label className="habit-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />{showArchived ? 'Đã lưu trữ' : 'Đang hoạt động'}</label>
      </div>

      <div className="habit-filters" aria-label="Lọc thói quen theo nhóm">
        <button className={categoryFilter === 'all' ? 'selected' : ''} onClick={() => setCategoryFilter('all')}>Tất cả</button>
        {categories.map((category) => <button key={category} className={categoryFilter === category ? 'selected' : ''} onClick={() => setCategoryFilter(category)}>{category}</button>)}
      </div>

      {loading ? <div className="habit-empty"><span className="habit-loading-mark"><RotateCcw size={19} /></span><h3>Đang tải thói quen...</h3></div> : visibleHabits.length === 0 ? <div className="habit-empty"><span className="habit-loading-mark"><Sparkles size={20} /></span><h3>{showArchived ? 'Chưa có thói quen đã lưu trữ' : 'Bắt đầu bằng một thói quen nhỏ'}</h3><p>{showArchived ? 'Những thói quen đã lưu sẽ xuất hiện ở đây.' : 'Tạo nhịp đầu tiên để theo dõi tiến độ mỗi ngày.'}</p>{!showArchived && <button className="text-button" onClick={openNew}><Plus size={15} />Tạo thói quen đầu tiên</button>}</div> : <div className="habit-card-list">
        {visibleHabits.map((habit) => {
          const progress = summary?.habits.find((item) => item.id === habit.id)
          const Icon = iconById[habit.icon] ?? Sparkles
          const completeToday = Boolean(dayByDate.get(today)?.completions.some((item) => item.habitId === habit.id))
          const weekCount = progress?.weeklyCount ?? 0
          return <article className={`habit-card ${habit.archived ? 'is-archived' : ''}`} key={habit.id}>
            <span className="habit-icon" style={{ backgroundColor: `${habit.color}18`, color: habit.color }}><Icon size={18} /></span>
            <div className="habit-card-main">
              <div className="habit-card-title"><h3>{habit.name}</h3><span className="habit-category-chip">{habit.category}</span></div>
              {habit.description && <p className="habit-description">{habit.description}</p>}
              <div className="habit-card-meta"><span>{habit.frequency === 'daily' ? 'Mỗi ngày' : `${habit.weeklyTarget} ngày / tuần`}</span><span>Hoàn thành {progress?.completionRate ?? 0}%</span><span>Chuỗi {progress?.currentStreak ?? 0} {habit.frequency === 'daily' ? 'ngày' : 'tuần'}</span><span>Dài nhất {progress?.longestStreak ?? 0} {habit.frequency === 'daily' ? 'ngày' : 'tuần'}</span></div>
              <div className="habit-week-progress"><div><span>Tiến độ tuần</span><strong>{weekCount}/{habit.frequency === 'daily' ? 7 : habit.weeklyTarget} · còn {Math.max(0, (habit.frequency === 'daily' ? 7 : habit.weeklyTarget) - weekCount)}</strong></div><span className="habit-week-track"><span style={{ width: `${Math.min(100, weekCount / (habit.frequency === 'daily' ? 7 : habit.weeklyTarget) * 100)}%`, backgroundColor: habit.color }} /></span></div>
            </div>
            {!habit.archived && <button className={`habit-check-button ${completeToday ? 'checked' : ''}`} onClick={() => void toggleCompletion(habit, today, !completeToday)} disabled={pendingKey === `${habit.id}:${today}`} aria-label={completeToday ? `Bỏ hoàn thành ${habit.name} hôm nay` : `Hoàn thành ${habit.name} hôm nay`} title={completeToday ? 'Đã hoàn thành hôm nay' : 'Đánh dấu hoàn thành'}>{completeToday ? <Check size={17} /> : <Circle size={21} />}</button>}
            <div className="habit-card-actions">
              <button onClick={() => openEdit(habit)} aria-label={`Chỉnh sửa ${habit.name}`} title="Chỉnh sửa"><Pencil size={15} /></button>
              <button onClick={() => void toggleArchive(habit)} disabled={pendingKey === habit.id} aria-label={habit.archived ? `Khôi phục ${habit.name}` : `Lưu trữ ${habit.name}`} title={habit.archived ? 'Khôi phục' : 'Lưu trữ'}><Archive size={15} /></button>
              <button onClick={() => setDeleteCandidate(habit)} aria-label={`Xóa ${habit.name}`} title="Xóa"><Trash2 size={15} /></button>
            </div>
          </article>
        })}
      </div>}

      <section className="habit-history-section">
        <div className="habit-section-heading"><div><h2>Lịch sử hoạt động</h2><p>Chọn một ngày để xem hoặc cập nhật ghi nhận.</p></div><div className="habit-view-switch" aria-label="Cách nhóm lịch sử">
          {([['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']] as const).map(([value, label]) => <button key={value} className={historyView === value ? 'selected' : ''} onClick={() => setHistoryView(value)}>{label}</button>)}
        </div></div>
        {loading ? <div className="habit-history-loading">Đang tải lịch sử...</div> : history.length === 0 ? <div className="habit-history-loading">Chưa có lịch sử trong khoảng thời gian này.</div> : <>
          <div className="habit-heatmap-wrap"><div className="habit-weekday-labels"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div><div className="habit-heatmap" aria-label="Lịch sử hoàn thành trong 12 tuần">
            {Array.from({ length: leadingCells }, (_, index) => <span className="habit-heatmap-pad" key={`pad-${index}`} />)}
            {history.map((day) => <button key={day.date} className={`habit-heatmap-day level-${Math.min(day.count, 4)} ${day.missedDaily ? 'has-missed' : ''} ${selectedDate === day.date ? 'selected' : ''}`} onClick={() => setSelectedDate(day.date)} aria-label={`${day.date}, ${day.count} lần hoàn thành, ${day.missedDaily} thói quen hằng ngày bị lỡ`} title={`${day.date}: ${day.count} lần hoàn thành, ${day.missedDaily} thói quen hằng ngày bị lỡ`} />)}
          </div></div>
          <div className="habit-heatmap-legend"><span>Ít hơn</span>{[0, 1, 2, 3, 4].map((level) => <span className={`habit-heatmap-day level-${level}`} key={level} />)}<span>Nhiều hơn</span><span className="habit-missed-legend-mark" /> <span>Có ngày lỡ</span><span className="habit-heatmap-selected-label">Đã chọn: {selectedDate}</span></div>
          <div className="habit-history-detail">
            <div className="habit-history-detail-heading"><div><strong>{new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${selectedDate}T00:00:00`))}</strong><span>{dayByDate.get(selectedDate)?.count ?? 0} lần hoàn thành</span></div><ChevronDown size={17} /></div>
            {eligibleOnSelectedDate.length ? <div className="habit-history-checklist">{eligibleOnSelectedDate.map((habit) => {
              const done = selectedCompletions.has(habit.id)
              const Icon = iconById[habit.icon] ?? Sparkles
              const canEditDate = !habit.archived && selectedDate <= today
              return <div className="habit-history-row" key={habit.id}><span className="habit-history-icon" style={{ color: habit.color }}><Icon size={15} /></span><span>{habit.name}</span><button className={done ? 'done' : ''} disabled={!canEditDate || pendingKey === `${habit.id}:${selectedDate}`} onClick={() => void toggleCompletion(habit, selectedDate, !done)} aria-label={`${done ? 'Bỏ ghi nhận' : 'Ghi nhận'} ${habit.name} ngày ${selectedDate}`}>{done ? <><Check size={14} />Hoàn thành</> : 'Ghi nhận'}</button></div>
            })}</div> : <p className="habit-history-empty">Không có thói quen áp dụng trong ngày này.</p>}
          </div>
          <div className="habit-chart-heading"><h3>{historyView === 'day' ? '14 ngày gần nhất' : historyView === 'week' ? 'So sánh theo tuần' : 'So sánh theo tháng'}</h3><span>Lượt hoàn thành</span></div>
          <div className={`habit-chart habit-chart-${historyView}`} role="img" aria-label={`Biểu đồ lịch sử theo ${historyView === 'day' ? 'ngày' : historyView === 'week' ? 'tuần' : 'tháng'}`}>
            {chartGroups.map((group) => <div className="habit-chart-column" key={group.key} title={`${group.key}: ${group.count} lượt`}><span className="habit-chart-value">{group.count || ''}</span><span className="habit-chart-bar" style={{ height: `${Math.max(3, group.count / chartMaximum * 100)}%` }} /><small>{group.label}</small></div>)}
          </div>
        </>}
      </section>

      {isFormOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setIsFormOpen(false) }}>
        <section className="task-modal habit-modal" role="dialog" aria-modal="true" aria-labelledby="habit-form-title">
          <div className="modal-heading"><div><p className="eyebrow"><span className="eyebrow-line" />THÓI QUEN MỚI</p><h2 id="habit-form-title">{editingHabit ? 'Chỉnh sửa thói quen' : 'Tạo thói quen'}</h2></div><button className="icon-button" onClick={() => setIsFormOpen(false)} aria-label="Đóng" disabled={saving}><X size={18} /></button></div>
          <form onSubmit={(event) => void saveHabit(event)}>
            <label className="field-label">Tên thói quen<input required autoFocus maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ví dụ: Đọc sách 20 phút" /></label>
            <label className="field-label">Mô tả <span className="optional-label">KHÔNG BẮT BUỘC</span><textarea rows={2} maxLength={300} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Một ghi chú ngắn cho nhịp này" /></label>
            <div className="field-grid"><label className="field-label">Danh mục<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="field-label">Tần suất<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as HabitDraft['frequency'], weeklyTarget: event.target.value === 'daily' ? 7 : 3 })}><option value="daily">Hằng ngày</option><option value="weekly">Theo tuần</option></select></label></div>
            {draft.frequency === 'weekly' && <label className="field-label">Mục tiêu mỗi tuần<select value={draft.weeklyTarget} onChange={(event) => setDraft({ ...draft, weeklyTarget: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((count) => <option value={count} key={count}>{count} ngày mỗi tuần</option>)}</select></label>}
            <div className="field-grid"><label className="field-label">Ngày bắt đầu<input required type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label><label className="field-label">Ngày kết thúc <span className="optional-label">TÙY CHỌN</span><input type="date" value={draft.endDate ?? ''} min={draft.startDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value || null })} /></label></div>
            <fieldset className="habit-option-field"><legend>Biểu tượng</legend><div className="habit-icon-options">{iconOptions.map(({ id, label, Icon }) => <button type="button" key={id} className={draft.icon === id ? 'selected' : ''} onClick={() => setDraft({ ...draft, icon: id })} aria-label={label} title={label}><Icon size={17} /></button>)}</div></fieldset>
            <fieldset className="habit-option-field"><legend>Màu sắc</legend><div className="habit-color-options">{colors.map((color) => <button type="button" key={color} className={draft.color === color ? 'selected' : ''} style={{ backgroundColor: color }} onClick={() => setDraft({ ...draft, color })} aria-label={`Chọn màu ${color}`} aria-pressed={draft.color === color} />)}</div></fieldset>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsFormOpen(false)} disabled={saving}>Hủy</button><button type="submit" className="primary-button" disabled={saving}><Plus size={16} />{saving ? 'Đang lưu...' : editingHabit ? 'Lưu thay đổi' : 'Tạo thói quen'}</button></div>
          </form>
        </section>
      </div>}

      {deleteCandidate && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteCandidate(null) }}><section className="task-modal habit-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-habit-title"><div className="modal-heading"><div><p className="eyebrow"><span className="eyebrow-line" />XÓA THÓI QUEN</p><h2 id="delete-habit-title">Bạn muốn xóa “{deleteCandidate.name}”?</h2></div><button className="icon-button" onClick={() => setDeleteCandidate(null)} aria-label="Đóng"><X size={18} /></button></div><p className="habit-delete-copy">Lịch sử hoàn thành của thói quen này cũng sẽ bị xóa và không thể khôi phục.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDeleteCandidate(null)}>Giữ lại</button><button className="habit-delete-confirm" onClick={() => void removeHabit()} disabled={pendingKey === deleteCandidate.id}><Trash2 size={15} />Xóa thói quen</button></div></section></div>}
    </section>
  )
}

export function HabitIcon({ habit, children }: { habit: Habit; children?: ReactNode }) {
  const Icon = iconById[habit.icon] ?? Sparkles
  return <span className="habit-icon" style={{ backgroundColor: `${habit.color}18`, color: habit.color }}><Icon size={18} />{children}</span>
}