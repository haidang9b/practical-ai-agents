import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, CheckCheck, Clock3, Flame, Target } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../lib/api';
import type { Project, Task } from '../types';
import PomodoroTimer from './PomodoroTimer';

interface AnalyticsData {
  range: { from: string; to: string; timeZone: string };
  activityRange: { from: string; to: string };
  totals: { created: number; completed: number; remaining: number; overdue: number };
  onTime: { completedOnTime: number; completedLate: number; overdue: number; eligible: number; rate: number | null };
  comparison: { previousCompleted: number; change: number | null };
  daily: Array<{ date: string; completed: number; focusSeconds: number }>;
  activity: Array<{ date: string; count: number }>;
  streak: { current: number; longest: number; dailyGoal: number };
  projects: Array<{ projectId: string | null; name: string; completed: number; focusSeconds: number }>;
  focusTotalSeconds: number;
}

interface AnalyticsPageProps {
  userId: string;
  projects: Project[];
  tasks: Task[];
}

type RangeMode = 'daily' | 'weekly' | 'monthly' | 'custom';

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function periodRange(mode: RangeMode, anchor: string): [string, string] {
  if (mode === 'daily') return [shiftDate(anchor, -13), anchor];
  if (mode === 'weekly') {
    const weekday = (new Date(`${anchor}T12:00:00.000Z`).getUTCDay() + 6) % 7;
    const monday = shiftDate(anchor, -weekday);
    return [monday, shiftDate(monday, 6)];
  }
  if (mode === 'monthly') {
    const first = `${anchor.slice(0, 7)}-01`;
    const lastDate = new Date(`${anchor.slice(0, 7)}-01T12:00:00.000Z`);
    lastDate.setUTCMonth(lastDate.getUTCMonth() + 1, 0);
    return [first, lastDate.toISOString().slice(0, 10)];
  }
  return [anchor, anchor];
}

function durationLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} phút`;
  if (minutes === 0) return `${hours} giờ`;
  return `${hours} giờ ${minutes} phút`;
}

function dateLabel(dateKey: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('vi-VN', options).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function heatmapDates(from: string, to: string): string[] {
  const weekday = (new Date(`${from}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  const start = shiftDate(from, -weekday);
  const lastDay = (new Date(`${to}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  const end = shiftDate(to, 6 - lastDay);
  const dates: string[] = [];
  for (let key = start; key <= end; key = shiftDate(key, 1)) dates.push(key);
  return dates;
}

function weeklyFocus(daily: AnalyticsData['daily']) {
  const weeks = new Map<string, number>();
  for (const item of daily) {
    const weekday = (new Date(`${item.date}T12:00:00.000Z`).getUTCDay() + 6) % 7;
    const monday = shiftDate(item.date, -weekday);
    weeks.set(monday, (weeks.get(monday) ?? 0) + item.focusSeconds);
  }
  return [...weeks.entries()].map(([week, seconds]) => ({ week, label: dateLabel(week), hours: Math.round((seconds / 3600) * 10) / 10, seconds }));
}

export default function AnalyticsPage({ userId, projects, tasks }: AnalyticsPageProps) {
  const today = localToday();
  const [mode, setMode] = useState<RangeMode>('daily');
  const [anchor, setAnchor] = useState(today);
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [projectId, setProjectId] = useState('all');
  const [dailyGoal, setDailyGoal] = useState(() => {
    const value = Number(localStorage.getItem(`analytics:daily-goal:${userId}`));
    return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 1;
  });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [from, to] = useMemo(() => mode === 'custom' ? [customFrom, customTo] : periodRange(mode, anchor), [mode, anchor, customFrom, customTo]);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';

  useEffect(() => {
    localStorage.setItem(`analytics:daily-goal:${userId}`, String(dailyGoal));
  }, [dailyGoal, userId]);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ from, to, timeZone, dailyGoal: String(dailyGoal) });
    if (projectId !== 'all') query.set('projectId', projectId);
    setLoading(true);
    setError('');
    apiRequest<{ analytics: AnalyticsData }>(`/analytics?${query.toString()}`)
      .then(({ analytics: result }) => { if (active) setAnalytics(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Chưa thể tải dữ liệu phân tích.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, timeZone, dailyGoal, projectId, refreshKey]);

  const activityByDate = useMemo(() => new Map((analytics?.activity ?? []).map((item) => [item.date, item.count])), [analytics]);
  const dates = useMemo(() => analytics ? heatmapDates(analytics.activityRange.from, analytics.activityRange.to) : [], [analytics]);
  const focusWeeks = useMemo(() => weeklyFocus(analytics?.daily ?? []), [analytics]);
  const completionChart = (analytics?.daily ?? []).map((item) => ({ ...item, label: dateLabel(item.date) }));
  const onTimeChart = analytics?.onTime.eligible ? [
    { name: 'Đúng hạn', value: analytics.onTime.completedOnTime, color: 'var(--green)' },
    { name: 'Trễ hạn', value: analytics.onTime.completedLate, color: 'var(--accent)' },
  ] : [];
  const maxProjectCount = Math.max(1, ...(analytics?.projects.map((project) => project.completed) ?? []));

  function navigatePeriod(direction: -1 | 1) {
    const amount = mode === 'weekly' ? 7 : mode === 'monthly' ? 0 : 14;
    if (mode === 'monthly') {
      const date = new Date(`${anchor}T12:00:00.000Z`);
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchor(`${date.toISOString().slice(0, 7)}-01`);
      return;
    }
    setAnchor(shiftDate(anchor, direction * amount));
  }

  return (
    <section className="analytics-section" aria-label="Bảng phân tích năng suất">
      <div className="analytics-toolbar">
        <div className="analytics-range-controls">
          <div className="analytics-segmented" role="group" aria-label="Khoảng thời gian">
            {([['daily', 'Ngày'], ['weekly', 'Tuần'], ['monthly', 'Tháng'], ['custom', 'Tùy chọn']] as const).map(([value, label]) => (
              <button key={value} className={mode === value ? 'is-selected' : ''} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>
            ))}
          </div>
          {mode !== 'custom' ? <div className="analytics-period-nav">
            <button className="icon-button" aria-label="Khoảng trước" onClick={() => navigatePeriod(-1)}><ArrowLeft size={15} /></button>
            <span>{dateLabel(from)} – {dateLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button className="icon-button" aria-label="Khoảng sau" disabled={to >= today} onClick={() => navigatePeriod(1)}><ArrowRight size={15} /></button>
          </div> : <div className="analytics-custom-dates">
            <label>Từ <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label>
            <label>Đến <input type="date" value={customTo} min={customFrom} max={today} onChange={(event) => setCustomTo(event.target.value)} /></label>
          </div>}
        </div>
        <div className="analytics-filters">
          <label>Dự án <select aria-label="Lọc phân tích theo dự án" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">Mọi dự án</option><option value="unassigned">Chưa phân loại</option>
            {projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
          <label>Mục tiêu ngày <input aria-label="Số công việc cho mục tiêu ngày" type="number" min="1" max="20" value={dailyGoal} onChange={(event) => setDailyGoal(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
        </div>
      </div>

      {error && <div className="analytics-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => setRefreshKey((value) => value + 1)}>Thử lại</button></div>}
      {loading && !analytics && <div className="analytics-loading" role="status">Đang tổng hợp nhịp làm việc…</div>}
      {analytics && <>
        <div className={`analytics-overview ${loading ? 'is-refreshing' : ''}`} aria-label="Tổng quan năng suất">
          <article className="analytics-stat stat-completed"><div><span>Đã hoàn thành</span><CheckCheck size={17} /></div><strong>{analytics.totals.completed}</strong><small>{analytics.comparison.change === null ? 'Chưa có kỳ trước để so sánh' : `${analytics.comparison.change > 0 ? '+' : ''}${analytics.comparison.change}% so với kỳ trước`}</small></article>
          <article className="analytics-stat stat-on-time"><div><span>Đúng hạn</span><Target size={17} /></div><strong>{analytics.onTime.rate === null ? '—' : `${analytics.onTime.rate}%`}</strong><small>{analytics.onTime.eligible ? `${analytics.onTime.completedOnTime} trên ${analytics.onTime.eligible} việc có hạn` : 'Chưa có việc hoàn thành có hạn'}</small></article>
          <article className="analytics-stat stat-focus"><div><span>Thời gian tập trung</span><Clock3 size={17} /></div><strong>{durationLabel(analytics.focusTotalSeconds)}</strong><small>{analytics.daily.filter((item) => item.focusSeconds > 0).length} ngày có phiên hoàn tất</small></article>
          <article className="analytics-stat stat-streak"><div><span>Chuỗi hiện tại</span><Flame size={17} /></div><strong>{analytics.streak.current}<i>ngày</i></strong><small>Dài nhất {analytics.streak.longest} ngày · mục tiêu {analytics.streak.dailyGoal}/ngày</small></article>
        </div>
        <div className="analytics-count-strip" aria-label="Số lượng công việc trong kỳ">
          <span><b>{analytics.totals.created}</b> đã tạo</span><span><b>{analytics.totals.completed}</b> hoàn thành</span><span><b>{analytics.totals.remaining}</b> còn mở</span><span className={analytics.totals.overdue ? 'has-overdue' : ''}><b>{analytics.totals.overdue}</b> quá hạn hiện tại</span>
        </div>

        <div className="analytics-grid">
          <article className="analytics-panel completion-panel">
            <div className="analytics-panel-heading"><div><p className="eyebrow">TIẾN ĐỘ</p><h2>Công việc hoàn thành</h2></div><span className="analytics-legend"><i />Mỗi ngày</span></div>
            <p className="chart-description">Số công việc hoàn thành theo ngày trong khoảng đã chọn.</p>
            {analytics.totals.completed === 0 ? <div className="analytics-empty">Chưa có công việc hoàn thành trong khoảng này.</div> : <div className="analytics-chart" role="img" aria-label={`Biểu đồ cột công việc hoàn thành theo ngày, tổng ${analytics.totals.completed} việc`}>
              <ResponsiveContainer width="100%" height="100%"><BarChart data={completionChart} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--soft-line)" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} interval={completionChart.length > 14 ? 'preserveStartEnd' : 0} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'var(--soft-line)', opacity: 0.6 }} contentStyle={{ background: 'var(--paper)', borderColor: 'var(--line)', borderRadius: 3, fontSize: 11 }} formatter={(value) => [value, 'Hoàn thành']} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? dateLabel(String(payload[0].payload.date), { weekday: 'long', day: 'numeric', month: 'long' }) : ''} />
                <Bar dataKey="completed" name="Hoàn thành" fill="var(--green)" radius={[2, 2, 0, 0]} maxBarSize={34} />
              </BarChart></ResponsiveContainer>
            </div>}
          </article>

          <article className="analytics-panel ontime-panel">
            <div className="analytics-panel-heading"><div><p className="eyebrow">ĐÚNG HẠN</p><h2>Đúng hạn và trễ hạn</h2></div><span className="chart-help" title="Chỉ tính task đã hoàn thành trong kỳ và có ngày đến hạn. Hoàn thành trong đúng ngày hạn được tính đúng hạn.">?</span></div>
            {analytics.onTime.rate === null ? <div className="analytics-empty">Chưa có việc hoàn thành có ngày đến hạn để tính tỷ lệ.</div> : <div className="ontime-chart-wrap" role="img" aria-label={`Tỷ lệ đúng hạn ${analytics.onTime.rate} phần trăm, ${analytics.onTime.completedOnTime} việc đúng hạn và ${analytics.onTime.completedLate} việc trễ hạn`}>
              <div className="ontime-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={onTimeChart} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="92%" paddingAngle={analytics.onTime.completedLate && analytics.onTime.completedOnTime ? 3 : 0} stroke="none">
                {onTimeChart.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
              </Pie><Tooltip contentStyle={{ background: 'var(--paper)', borderColor: 'var(--line)', borderRadius: 3, fontSize: 11 }} /></PieChart></ResponsiveContainer><strong>{analytics.onTime.rate}%</strong></div>
              <div className="ontime-legend"><span><i className="legend-green" />Đúng hạn <b>{analytics.onTime.completedOnTime}</b></span><span><i className="legend-accent" />Trễ hạn <b>{analytics.onTime.completedLate}</b></span><span><i className="legend-muted" />Quá hạn còn mở <b>{analytics.onTime.overdue}</b></span></div>
            </div>}
            <p className="chart-footnote">Không tính việc chưa có hạn. Mốc hoàn tất là lúc trạng thái chuyển sang hoàn thành.</p>
          </article>

          <article className="analytics-panel focus-chart-panel">
            <div className="analytics-panel-heading"><div><p className="eyebrow">NHỊP TẬP TRUNG</p><h2>Thời gian theo tuần</h2></div><span className="analytics-legend"><i className="legend-yellow" />Giờ tập trung</span></div>
            <p className="chart-description">Phiên hoàn tất được tính vào tuần có ngày kết thúc phiên.</p>
            {analytics.focusTotalSeconds === 0 ? <div className="analytics-empty">Hoàn thành một phiên Pomodoro để xem thời gian tập trung tại đây.</div> : <div className="analytics-chart" role="img" aria-label="Biểu đồ cột thời gian tập trung theo tuần, đơn vị giờ">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={focusWeeks} margin={{ top: 6, right: 6, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--soft-line)" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'var(--paper)', borderColor: 'var(--line)', borderRadius: 3, fontSize: 11 }} formatter={(_value, _name, item) => [durationLabel(Number(item.payload.seconds)), 'Tập trung']} labelFormatter={(_, payload) => payload?.[0]?.payload?.week ? `Tuần từ ${dateLabel(String(payload[0].payload.week), { day: 'numeric', month: 'long', year: 'numeric' })}` : ''} />
                <Bar dataKey="hours" name="Giờ" fill="var(--yellow)" radius={[2, 2, 0, 0]} maxBarSize={42} />
              </BarChart></ResponsiveContainer>
            </div>}
          </article>

          <article className="analytics-panel heatmap-panel">
            <div className="analytics-panel-heading"><div><p className="eyebrow">THÓI QUEN</p><h2>Lịch hoạt động</h2></div><span className="streak-badge"><Flame size={14} />{analytics.streak.current} ngày</span></div>
            <p className="chart-description">Ngày đạt mục tiêu là ngày có ít nhất {dailyGoal} công việc hoàn thành.</p>
            {analytics.activity.length === 0 ? <div className="analytics-empty heatmap-empty">Chưa có ngày hoạt động trong 365 ngày gần đây.</div> : <div className="heatmap-scroll">
              <div className="heatmap-weekdays" aria-hidden="true"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
              <div className="activity-heatmap" role="img" aria-label={`Lịch hoạt động gồm ${analytics.activity.length} ngày có công việc hoàn thành`}>
                {dates.map((date) => {
                  const count = activityByDate.get(date) ?? 0;
                  const level = count === 0 ? 0 : count >= dailyGoal * 3 ? 4 : count >= dailyGoal * 2 ? 3 : count >= dailyGoal ? 2 : 1;
                  const weekday = (new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7;
                  return <span key={date} className={`heatmap-cell heat-level-${level}`} style={{ gridRow: weekday + 1 }} title={`${dateLabel(date, { day: 'numeric', month: 'long', year: 'numeric' })}: ${count} công việc`} aria-label={`${date}, ${count} công việc`} />;
                })}
              </div>
            </div>}
            <div className="heatmap-legend"><span>Ít</span><i className="heat-level-0" /><i className="heat-level-1" /><i className="heat-level-2" /><i className="heat-level-3" /><i className="heat-level-4" /><span>Nhiều</span></div>
          </article>

          {analytics.projects.length > 0 && <article className="analytics-panel project-breakdown-panel">
            <div className="analytics-panel-heading"><div><p className="eyebrow">THEO DỰ ÁN</p><h2>Tiến độ trong kỳ</h2></div><Activity size={17} /></div>
            <div className="project-breakdown-list">{analytics.projects.map((project) => <div className="project-breakdown-row" key={project.projectId ?? 'unassigned'}>
              <span title={project.name}>{project.name}</span><div className="project-breakdown-track"><i style={{ width: `${Math.min(100, (project.completed / maxProjectCount) * 100)}%` }} /></div><b>{project.completed}</b><small>{durationLabel(project.focusSeconds)}</small>
            </div>)}</div>
          </article>}

          <PomodoroTimer userId={userId} tasks={tasks} projects={projects} onCompleted={() => setRefreshKey((value) => value + 1)} />
        </div>
      </>}
    </section>
  );
}