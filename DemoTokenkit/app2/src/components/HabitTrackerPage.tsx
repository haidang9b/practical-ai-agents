import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, Check, ChevronLeft, ChevronRight, Flame, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api';

type Frequency = 'daily' | 'weekly';
interface Habit {
  id: string; name: string; description: string; category: string; icon: string; color: string;
  frequency: Frequency; weeklyTarget: number; startDate: string; endDate: string; archived: boolean;
  currentStreak: number; longestStreak: number; completionRate: number; weeklyCompleted: number; weeklyRemaining: number;
}
interface Summary { today: string; completedToday: number; activeToday: number; completionRate: number; habits: Habit[] }
interface Completion { habitId: string; date: string }
interface Draft { name: string; description: string; category: string; icon: string; color: string; frequency: Frequency; weeklyTarget: number; startDate: string; endDate: string }

const categories = ['Sức khỏe', 'Học tập', 'Thể dục', 'Công việc', 'Cá nhân'];
const colors = ['#56846c', '#df634d', '#c18a36', '#4f8790', '#766b52'];
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
};
const shiftDate = (value: string, amount: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
};
const blankDraft = (): Draft => ({ name: '', description: '', category: 'Sức khỏe', icon: '🌱', color: colors[0], frequency: 'daily', weeklyTarget: 3, startDate: localToday(), endDate: '' });

export default function HabitTrackerPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [category, setCategory] = useState('Tất cả');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const [periodAnchor, setPeriodAnchor] = useState(localToday);
  const [historyHabitId, setHistoryHabitId] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);

  const today = summary?.today ?? localToday();
  const clientTimeZone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh');
  const rangeStart = period === 'day' ? periodAnchor : period === 'week'
    ? shiftDate(periodAnchor, -((new Date(`${periodAnchor}T12:00:00`).getDay() + 6) % 7))
    : `${periodAnchor.slice(0, 7)}-01`;
  const periodEnd = period === 'day' ? periodAnchor : period === 'week'
    ? shiftDate(rangeStart, 6)
    : (() => {
      const lastDay = new Date(Number(periodAnchor.slice(0, 4)), Number(periodAnchor.slice(5, 7)), 0);
      return `${lastDay.getFullYear()}-${`${lastDay.getMonth() + 1}`.padStart(2, '0')}-${`${lastDay.getDate()}`.padStart(2, '0')}`;
    })();
  const rangeEnd = periodEnd > today ? today : periodEnd;

  async function reload() {
    const [overview, history] = await Promise.all([
      apiRequest<{ summary: Summary }>(`/habit-analytics/summary?timeZone=${clientTimeZone}`),
      apiRequest<{ completions: Completion[] }>(`/habit-analytics/history?from=${rangeStart}&to=${rangeEnd}&timeZone=${clientTimeZone}`),
    ]);
    setSummary(overview.summary);
    setCompletions(history.completions);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      apiRequest<{ summary: Summary }>(`/habit-analytics/summary?timeZone=${clientTimeZone}`),
      apiRequest<{ completions: Completion[] }>(`/habit-analytics/history?from=${rangeStart}&to=${rangeEnd}&timeZone=${clientTimeZone}`),
    ]).then(([overview, history]) => {
      if (!active) return;
      setSummary(overview.summary);
      setCompletions(history.completions);
      setError('');
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Chưa thể tải thói quen.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [rangeStart, rangeEnd, clientTimeZone]);

  const visibleHabits = useMemo(() => (summary?.habits ?? []).filter((habit) =>
    habit.archived === (status === 'archived') && (category === 'Tất cả' || habit.category === category),
  ), [summary, status, category]);
  const completionByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of completions) counts.set(entry.date, (counts.get(entry.date) ?? 0) + 1);
    return counts;
  }, [completions]);
  const heatmapDates = useMemo(() => {
    const days = Math.floor((Date.parse(`${rangeEnd}T12:00:00Z`) - Date.parse(`${rangeStart}T12:00:00Z`)) / 86400000) + 1;
    return Array.from({ length: days }, (_, index) => shiftDate(rangeEnd, index - days + 1));
  }, [rangeStart, rangeEnd]);
  const totalHabits = summary?.activeToday ?? 0;
  const totalDone = summary?.completedToday ?? 0;
  const selectedHistoryHabit = summary?.habits.find((habit) => habit.id === historyHabitId);
  const mostConsistentHabit = (summary?.habits ?? []).filter((habit) => !habit.archived).reduce<Habit | null>((best, habit) =>
    !best || habit.completionRate > best.completionRate || habit.completionRate === best.completionRate && habit.longestStreak > best.longestStreak ? habit : best,
  null);

  function moveHistory(direction: -1 | 1) {
    if (period === 'day') setPeriodAnchor((value) => shiftDate(value, direction));
    else if (period === 'week') setPeriodAnchor((value) => shiftDate(value, direction * 7));
    else {
      const date = new Date(`${periodAnchor.slice(0, 7)}-01T12:00:00`);
      date.setMonth(date.getMonth() + direction);
      setPeriodAnchor(`${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-01`);
    }
  }

  function openCreate() {
    setEditing(null);
    setDraft(blankDraft());
    setError('');
    setFormOpen(true);
  }
  function openEdit(habit: Habit) {
    setEditing(habit);
    setDraft({ name: habit.name, description: habit.description, category: habit.category, icon: habit.icon, color: habit.color, frequency: habit.frequency, weeklyTarget: habit.weeklyTarget, startDate: habit.startDate, endDate: habit.endDate });
    setError('');
    setFormOpen(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest(editing ? `/habits/${encodeURIComponent(editing.id)}` : '/habits', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(draft),
      });
      setNotice(editing ? 'Đã cập nhật thói quen.' : 'Đã tạo thói quen mới.');
      setFormOpen(false);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa thể lưu thói quen.');
    } finally { setSaving(false); }
  }
  async function toggleCompletion(habit: Habit, date = today) {
    if (pendingIds.has(habit.id)) return;
    const done = completions.some((entry) => entry.habitId === habit.id && entry.date === date);
    setPendingIds((current) => new Set(current).add(habit.id));
    try {
      setError('');
      await apiRequest(`/habits/${encodeURIComponent(habit.id)}/completions/${date}?timeZone=${clientTimeZone}`, { method: done ? 'DELETE' : 'PUT' });
      setNotice(done ? 'Đã hoàn tác lần hoàn thành.' : 'Đã ghi nhận tiến độ.');
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể cập nhật tiến độ.'); }
    finally { setPendingIds((current) => { const next = new Set(current); next.delete(habit.id); return next; }); }
  }
  async function archiveHabit(habit: Habit) {
    try {
      setError('');
      await apiRequest(`/habits/${encodeURIComponent(habit.id)}`, { method: 'PATCH', body: JSON.stringify({ archived: !habit.archived }) });
      setNotice(habit.archived ? 'Đã khôi phục thói quen.' : 'Đã lưu trữ thói quen.');
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể cập nhật thói quen.'); }
  }
  async function deleteHabit(habit: Habit) {
    if (!window.confirm(`Xóa “${habit.name}” và toàn bộ lịch sử của thói quen này?`)) return;
    try {
      await apiRequest(`/habits/${encodeURIComponent(habit.id)}`, { method: 'DELETE' });
      setNotice('Đã xóa thói quen và lịch sử.');
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể xóa thói quen.'); }
  }

  return <section className="habit-page" aria-label="Theo dõi thói quen">
    {notice && <p className="habit-notice" role="status">{notice}<button aria-label="Đóng thông báo" onClick={() => setNotice('')}><X size={14} /></button></p>}
    {error && <p className="habit-error" role="alert">{error}<button className="text-button" onClick={() => { setError(''); void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Chưa thể tải lại.')); }}>Thử lại</button></p>}
    <div className="habit-overview" aria-label="Tiến độ hôm nay">
      <div><span className="habit-overview-kicker">HÔM NAY</span><strong>{totalDone}<i>/{totalHabits}</i></strong><span>thói quen đã hoàn thành</span></div>
      <div className="habit-overview-progress"><div className="habit-progress-track"><i style={{ width: `${summary?.completionRate ?? 0}%` }} /></div><span>{summary?.completionRate ?? 0}% tiến độ ngày</span></div>
      <div className="habit-overview-mark"><Sparkles size={22} /><span>{mostConsistentHabit ? <>Ổn định nhất: <b>{mostConsistentHabit.name}</b> · {mostConsistentHabit.completionRate}%</> : totalHabits - totalDone > 0 ? `Còn ${totalHabits - totalDone} nhịp nhỏ` : 'Bạn đã giữ nhịp hôm nay'}</span></div>
    </div>

    <div className="habit-section-heading">
      <div><div className="section-title-row"><h2>{status === 'active' ? 'Thói quen của bạn' : 'Đã lưu trữ'}</h2><span className="result-count">{visibleHabits.length}</span></div><p>Tiến bộ bền vững bắt đầu từ những lần lặp lại nhỏ.</p></div>
      <button className="primary-button" onClick={openCreate}><Plus size={16} /><span>Thêm thói quen</span></button>
    </div>
    <div className="habit-toolbar">
      <label><span>Nhóm</span><select aria-label="Lọc theo nhóm thói quen" value={category} onChange={(event) => setCategory(event.target.value)}><option>Tất cả</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <div className="analytics-segmented" aria-label="Trạng thái thói quen"><button className={status === 'active' ? 'is-selected' : ''} onClick={() => setStatus('active')}>Đang theo dõi</button><button className={status === 'archived' ? 'is-selected' : ''} onClick={() => setStatus('archived')}>Đã lưu trữ</button></div>
    </div>

    {loading ? <div className="habit-loading" role="status">Đang tải thói quen...</div> : visibleHabits.length ? <div className="habit-list">
      {visibleHabits.map((habit) => {
        const doneToday = completions.some((entry) => entry.habitId === habit.id && entry.date === today);
        const percentage = habit.frequency === 'daily' ? (doneToday ? 100 : 0) : Math.min(100, Math.round(habit.weeklyCompleted / habit.weeklyTarget * 100));
        return <article className="habit-row" key={habit.id} style={{ '--habit-color': habit.color } as React.CSSProperties}>
          <div className="habit-glyph" aria-hidden="true">{habit.icon}</div>
          <div className="habit-info"><div className="habit-title-line"><h3>{habit.name}</h3><span className="habit-category">{habit.category}</span></div>{habit.description && <p>{habit.description}</p>}
            <div className="habit-meta"><span>{habit.frequency === 'daily' ? 'Mỗi ngày' : `${habit.weeklyTarget} ngày / tuần`}</span><span>{habit.weeklyCompleted}/{habit.weeklyTarget} tuần này</span><span>Còn {habit.weeklyRemaining}</span></div>
            <div className="habit-progress-track"><i style={{ width: `${percentage}%` }} /></div>
          </div>
          <div className="habit-streak"><span><Flame size={14} />{habit.currentStreak}</span><small>chuỗi hiện tại</small><small>Dài nhất {habit.longestStreak}</small></div>
          <div className="habit-actions"><button className={`habit-check ${doneToday ? 'is-done' : ''}`} aria-label={doneToday ? `Hoàn tác: ${habit.name}` : `Hoàn thành: ${habit.name}`} disabled={status === 'archived' || pendingIds.has(habit.id)} onClick={() => void toggleCompletion(habit)}>{doneToday ? <Check size={18} /> : <span />}</button>
            <button className="icon-button" aria-label={`Sửa: ${habit.name}`} title="Chỉnh sửa" onClick={() => openEdit(habit)}><Pencil size={14} /></button>
            <button className="icon-button" aria-label={habit.archived ? `Khôi phục: ${habit.name}` : `Lưu trữ: ${habit.name}`} title={habit.archived ? 'Khôi phục' : 'Lưu trữ'} onClick={() => void archiveHabit(habit)}>{habit.archived ? <RotateCcw size={14} /> : <Archive size={14} />}</button>
            <button className="icon-button delete-button" aria-label={`Xóa: ${habit.name}`} title="Xóa" onClick={() => void deleteHabit(habit)}><Trash2 size={14} /></button>
          </div>
        </article>;
      })}
    </div> : <div className="habit-empty"><span><Sparkles size={21} /></span><h3>{status === 'archived' ? 'Chưa có thói quen lưu trữ' : 'Bắt đầu với một nhịp nhỏ'}</h3><p>{status === 'archived' ? 'Các thói quen bạn lưu trữ sẽ xuất hiện ở đây.' : 'Tạo thói quen đầu tiên để theo dõi tiến độ mỗi ngày.'}</p>{status === 'active' && <button className="text-button" onClick={openCreate}><Plus size={15} />Tạo thói quen đầu tiên</button>}</div>}

    <section className="habit-history" aria-label="Lịch sử hoạt động">
      <div className="habit-section-heading history-heading"><div><div className="section-title-row"><h2>Lịch sử hoạt động</h2></div><p>{completions.length} lượt hoàn thành trong khoảng đã chọn.</p></div><div className="habit-history-controls"><div className="analytics-segmented" aria-label="Khoảng thời gian"><button className={period === 'day' ? 'is-selected' : ''} onClick={() => { setPeriod('day'); setPeriodAnchor(today); }}>Ngày</button><button className={period === 'week' ? 'is-selected' : ''} onClick={() => { setPeriod('week'); setPeriodAnchor(today); }}>Tuần</button><button className={period === 'month' ? 'is-selected' : ''} onClick={() => { setPeriod('month'); setPeriodAnchor(today); }}>Tháng</button></div><div className="habit-period-nav"><button className="icon-button" aria-label="Khoảng trước" onClick={() => moveHistory(-1)}><ChevronLeft size={15} /></button><span>{rangeStart} – {rangeEnd}</span><button className="icon-button" aria-label="Khoảng sau" disabled={rangeEnd >= today} onClick={() => moveHistory(1)}><ChevronRight size={15} /></button><button className="text-button" disabled={rangeEnd >= today} onClick={() => setPeriodAnchor(today)}>Hôm nay</button></div></div></div>
      <label className="habit-history-filter">Sửa lịch sử của<select aria-label="Thói quen trong lịch sử" value={historyHabitId} onChange={(event) => setHistoryHabitId(event.target.value)}><option value="">Chỉ xem lịch sử</option>{(summary?.habits ?? []).map((habit) => <option key={habit.id} value={habit.id}>{habit.name}{habit.archived ? ' · Đã lưu trữ' : ''}</option>)}</select></label>
      <div className={`habit-heatmap ${period === 'day' ? 'is-day' : ''}`} aria-label="Lịch hoàn thành">
        {heatmapDates.map((date) => { const count = completionByDate.get(date) ?? 0; const completed = completions.some((entry) => entry.habitId === historyHabitId && entry.date === date); const canEdit = !!selectedHistoryHabit && date <= today && date >= selectedHistoryHabit.startDate && (!selectedHistoryHabit.endDate || date <= selectedHistoryHabit.endDate) && (!selectedHistoryHabit.archived || completed); return <button type="button" key={date} className={`habit-heat-cell heat-level-${count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3} ${completed ? 'is-selected' : ''}`} disabled={!canEdit} onClick={() => selectedHistoryHabit && void toggleCompletion(selectedHistoryHabit, date)} title={`${date}: ${count} lần hoàn thành`} aria-label={`${date}: ${count} lần hoàn thành${completed ? ', đã ghi nhận cho thói quen đang chọn' : ''}`} aria-pressed={completed} />; })}
      </div>
      <div className="habit-heat-legend"><span>Ít hơn</span><i className="heat-level-0" /><i className="heat-level-1" /><i className="heat-level-2" /><i className="heat-level-3" /><span>Nhiều hơn</span></div>
    </section>

    {formOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}><section className="task-dialog habit-dialog" role="dialog" aria-modal="true" aria-labelledby="habit-dialog-title">
      <div className="dialog-heading"><div><span className="eyebrow">MỘT NHỊP NHỎ MỖI NGÀY</span><h2 id="habit-dialog-title">{editing ? 'Chỉnh sửa thói quen' : 'Tạo thói quen mới'}</h2></div><button className="icon-button dialog-close" onClick={() => setFormOpen(false)} aria-label="Đóng"><X size={18} /></button></div>
      <form onSubmit={(event) => void submit(event)}>
        <label className="form-label" htmlFor="habit-name">Tên thói quen <span>*</span></label><input id="habit-name" className="form-control title-input" maxLength={120} required autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ví dụ: Đọc sách 20 phút" />
        <label className="form-label" htmlFor="habit-description">Mô tả <small>Không bắt buộc</small></label><textarea id="habit-description" className="form-control description-input" maxLength={2000} rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Điều gì giúp bạn bắt đầu?" />
        <div className="form-grid"><div><label className="form-label" htmlFor="habit-category">Nhóm</label><select id="habit-category" className="form-control" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="form-label" htmlFor="habit-icon">Biểu tượng</label><input id="habit-icon" className="form-control" maxLength={16} value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })} /></div></div>
        <label className="form-label">Màu sắc</label><div className="habit-color-picker" role="group" aria-label="Chọn màu thói quen">{colors.map((color) => <button type="button" key={color} aria-label={`Màu ${color}`} aria-pressed={draft.color === color} style={{ backgroundColor: color }} onClick={() => setDraft({ ...draft, color })} />)}</div>
        <fieldset className="habit-frequency"><legend>Tần suất</legend><label><input type="radio" name="frequency" checked={draft.frequency === 'daily'} onChange={() => setDraft({ ...draft, frequency: 'daily' })} />Mỗi ngày</label><label><input type="radio" name="frequency" checked={draft.frequency === 'weekly'} onChange={() => setDraft({ ...draft, frequency: 'weekly' })} />Mục tiêu theo tuần</label></fieldset>
        {draft.frequency === 'weekly' && <label className="form-label" htmlFor="habit-target">Số ngày mục tiêu mỗi tuần</label>}{draft.frequency === 'weekly' && <input id="habit-target" className="form-control" type="number" min={1} max={7} value={draft.weeklyTarget} onChange={(event) => setDraft({ ...draft, weeklyTarget: Number(event.target.value) })} />}
        <div className="form-grid"><div><label className="form-label" htmlFor="habit-start">Ngày bắt đầu</label><input id="habit-start" className="form-control" type="date" required value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></div><div><label className="form-label" htmlFor="habit-end">Ngày kết thúc <small>Không bắt buộc</small></label><input id="habit-end" className="form-control" type="date" min={draft.startDate} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setFormOpen(false)}>Hủy</button><button className="primary-button" disabled={saving} type="submit"><Check size={16} />{saving ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Tạo thói quen'}</button></div>
      </form>
    </section></div>}
  </section>;
}
