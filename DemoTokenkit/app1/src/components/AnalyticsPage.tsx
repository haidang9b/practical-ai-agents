import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeft, ArrowRight, BarChart3, Check, CirclePause, CirclePlay, Clock3, Flame, RotateCcw, Target, TimerReset } from 'lucide-react'
import { getActiveFocusSession, getAnalytics, startFocusSession, updateFocusSession, type AnalyticsData, type FocusSession } from '../lib/api'
import type { Project } from '../types/project'
import type { Task } from '../types/task'

type Period = 'day' | 'week' | 'month'
type FocusView = 'daily' | 'weekly'
type Filters = { startDate: string; endDate: string }

interface AnalyticsPageProps {
  token: string
  tasks: Task[]
  projects: Project[]
  onTokenRefresh: (token: string) => void
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function moveDate(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return dateKey(date)
}

function rangeFor(period: Period, anchor: string): Filters {
  const date = new Date(`${anchor}T12:00:00`)
  const today = dateKey(new Date())
  if (period === 'day') return { startDate: moveDate(anchor, -6), endDate: anchor > today ? today : anchor }
  if (period === 'week') {
    const mondayOffset = (date.getDay() + 6) % 7
    const startDate = moveDate(anchor, -mondayOffset)
    const endDate = moveDate(startDate, 6)
    return { startDate, endDate: endDate > today ? today : endDate }
  }
  date.setDate(1)
  const startDate = dateKey(date)
  date.setMonth(date.getMonth() + 1, 0)
  const endDate = dateKey(date)
  return { startDate, endDate: endDate > today ? today : endDate }
}

function shiftPeriod(value: string, period: Period, direction: -1 | 1): string {
  if (period === 'day') return moveDate(value, direction)
  if (period === 'week') return moveDate(value, direction * 7)
  const date = new Date(`${value}T12:00:00`)
  date.setMonth(date.getMonth() + direction, 1)
  return dateKey(date)
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`))
}

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} giờ ${minutes % 60} phút` : `${minutes} phút`
}

  function readMinutes(key: string, fallback: number, maximum: number): number {
    const value = Number(localStorage.getItem(key))
    return Number.isInteger(value) && value >= 1 && value <= maximum ? value : fallback
  }

function weekLabel(value: string): string {
  return `Tuần từ ${shortDate(value)}`
}

function Stat({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
  return <article className="analytics-stat"><span className="analytics-stat-icon">{icon}</span><span className="analytics-stat-label">{label}</span><strong>{value}</strong><small>{note}</small></article>
}

export default function AnalyticsPage({ token, tasks, projects, onTokenRefresh }: AnalyticsPageProps) {
  const today = dateKey(new Date())
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(today)
  const [custom, setCustom] = useState<Filters | null>(null)
  const [projectId, setProjectId] = useState('')
  const [dailyGoal, setDailyGoal] = useState(() => readMinutes('viec-nho:daily-goal', 1, 20))
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [focusView, setFocusView] = useState<FocusView>('weekly')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [focusMinutes, setFocusMinutes] = useState(() => readMinutes('viec-nho:focus-minutes', 25, 120))
  const [breakMinutes, setBreakMinutes] = useState(() => readMinutes('viec-nho:break-minutes', 5, 60))
  const [focusTaskId, setFocusTaskId] = useState('')
  const [focusProjectId, setFocusProjectId] = useState('')
  const [session, setSession] = useState<FocusSession | null>(null)
  const [clockNow, setClockNow] = useState(Date.now())
  const [timerError, setTimerError] = useState('')
    const [analyticsVersion, setAnalyticsVersion] = useState(0)
  const [breakUntil, setBreakUntil] = useState(() => Number(localStorage.getItem('viec-nho:break-until') ?? 0))
  const [breakActive, setBreakActive] = useState(() => Number(localStorage.getItem('viec-nho:break-until') ?? 0) > Date.now())
  const filters = useMemo(() => custom ?? rangeFor(period, anchor), [custom, period, anchor])
  const startDate = filters.startDate
  const endDate = filters.endDate
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    getAnalytics(token, { startDate, endDate, timezone, ...(projectId ? { projectId } : {}), dailyGoal }, onTokenRefresh)
      .then((result) => { if (current) setData(result) })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'Không thể tải thống kê.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [token, startDate, endDate, timezone, projectId, dailyGoal, onTokenRefresh, analyticsVersion])

  useEffect(() => {
    let current = true
    getActiveFocusSession(token, onTokenRefresh)
      .then(({ session: active }) => {
        if (current) {
          setSession(active)
          if (active) {
            setFocusTaskId(active.taskId ?? '')
            setFocusProjectId(active.projectId ?? '')
          }
        }
      })
      .catch((cause: unknown) => { if (current) setTimerError(cause instanceof Error ? cause.message : 'Không thể khôi phục phiên tập trung.') })
    return () => { current = false }
  }, [token, onTokenRefresh])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    localStorage.setItem('viec-nho:focus-minutes', String(focusMinutes))
    localStorage.setItem('viec-nho:break-minutes', String(breakMinutes))
    localStorage.setItem('viec-nho:daily-goal', String(dailyGoal))
  }, [focusMinutes, breakMinutes, dailyGoal])

  const closedFocusSeconds = session?.accumulatedSeconds ?? session?.durationSeconds ?? 0
  const runningSeconds = session?.status === 'running' && session.activeSegmentStartedAt
    ? Math.max(0, Math.floor((clockNow - new Date(session.activeSegmentStartedAt).getTime()) / 1000))
    : 0
  const remainingSeconds = session
    ? Math.max(0, session.plannedDurationSeconds - closedFocusSeconds - runningSeconds)
    : breakActive ? Math.max(0, Math.ceil((breakUntil - clockNow) / 1000)) : focusMinutes * 60

  const completingSession = useRef<string | null>(null)
  useEffect(() => {
    if (!session || session.status !== 'running' || remainingSeconds > 0) return
    if (completingSession.current === session.id) return
    completingSession.current = session.id
    void updateFocusSession(token, session.id, 'complete', onTokenRefresh)
      .then(() => {
        setSession(null)
        setBreakUntil(Date.now() + breakMinutes * 60_000)
        setBreakActive(true)
        localStorage.setItem('viec-nho:break-until', String(Date.now() + breakMinutes * 60_000))
        setTimerError('')
        setAnalyticsVersion((version) => version + 1)
      })
      .catch((cause: unknown) => {
        completingSession.current = null
        setTimerError(cause instanceof Error ? cause.message : 'Không thể lưu phiên tập trung.')
      })
  }, [session, remainingSeconds, token, onTokenRefresh, breakMinutes])
  useEffect(() => {
    if (!breakActive || session || remainingSeconds > 0) return
    setBreakActive(false)
    setBreakUntil(0)
    localStorage.removeItem('viec-nho:break-until')
  }, [breakActive, session, remainingSeconds])

  const changeRange = (changes: Partial<Filters>) => {
    setCustom((current) => ({ ...(current ?? filters), ...changes }))
  }

  const navigate = (direction: -1 | 1) => {
    setCustom(null)
    setAnchor(shiftPeriod(anchor, period, direction))
  }

  const setPeriodView = (value: Period) => {
    setPeriod(value)
    setCustom(null)
    setAnchor(today)
  }

  const startFocus = async () => {
    setTimerError('')
    try {
      const result = await startFocusSession(token, {
        durationSeconds: focusMinutes * 60,
        taskId: focusTaskId || null,
        projectId: focusProjectId || null,
      }, onTokenRefresh)
      setSession(result.session)
      setBreakActive(false)
    } catch (cause) {
      setTimerError(cause instanceof Error ? cause.message : 'Không thể bắt đầu phiên tập trung.')
    }
  }

  const sessionAction = async (action: 'pause' | 'resume' | 'interrupt') => {
    if (!session) return
    setTimerError('')
    try {
      const { session: updated } = await updateFocusSession(token, session.id, action, onTokenRefresh)
      setSession(action === 'interrupt' ? null : updated)
      if (action === 'interrupt') setBreakActive(false)
    } catch (cause) {
      setTimerError(cause instanceof Error ? cause.message : 'Không thể cập nhật phiên tập trung.')
    }
  }

  const startBreak = () => {
    const until = Date.now() + breakMinutes * 60_000
    setBreakUntil(until)
    setBreakActive(true)
    localStorage.setItem('viec-nho:break-until', String(until))
  }

  const stopBreak = () => {
    setBreakActive(false)
    setBreakUntil(0)
    localStorage.removeItem('viec-nho:break-until')
  }

  const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0')
  const seconds = String(remainingSeconds % 60).padStart(2, '0')
  const maxCompleted = Math.max(1, ...((data?.completion ?? []).map((item) => item.count)))
  const rate = data?.onTime.rate
  const completedDelta = data ? data.totals.completed - data.totals.comparison.completed : 0
  const focusDelta = data ? data.focus.totalSeconds - data.focus.previousPeriodSeconds : 0
  const deltaLabel = (value: number, suffix: string) => `${value > 0 ? '+' : ''}${value} ${suffix} so với kỳ trước`
  const focusEntries = data ? focusView === 'daily'
    ? data.focus.daily.map((item) => ({ key: item.date, label: shortDate(item.date), seconds: item.seconds }))
    : data.focus.weekly.map((item) => ({ key: item.weekStart, label: weekLabel(item.weekStart), seconds: item.seconds }))
    : []

  return <section className="analytics-page" aria-label="Bảng phân tích năng suất">
    <div className="analytics-toolbar">
      <div className="analytics-period-switch" role="group" aria-label="Khoảng thời gian">
        {([['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']] as const).map(([key, label]) => <button key={key} className={period === key && !custom ? 'selected' : ''} onClick={() => setPeriodView(key)} aria-pressed={period === key && !custom}>{label}</button>)}
      </div>
      <div className="analytics-navigation">
        <button className="analytics-icon-button" onClick={() => navigate(-1)} aria-label="Khoảng trước"><ArrowLeft size={15} /></button>
        <label><span>Từ</span><input type="date" value={filters.startDate} max={filters.endDate} onChange={(event) => changeRange({ startDate: event.target.value })} aria-label="Ngày bắt đầu" /></label>
        <label><span>Đến</span><input type="date" value={filters.endDate} min={filters.startDate} max={today} onChange={(event) => changeRange({ endDate: event.target.value })} aria-label="Ngày kết thúc" /></label>
        <button className="analytics-icon-button" onClick={() => navigate(1)} disabled={filters.endDate >= today} aria-label="Khoảng sau"><ArrowRight size={15} /></button>
      </div>
      <label className="analytics-select"><span>Dự án</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Tất cả dự án</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    </div>

    {error && <p className="task-error" role="alert">{error}</p>}
    {loading && !data ? <div className="analytics-state" role="status">Đang tải dữ liệu năng suất...</div> : data && <>
      <div className="analytics-stat-grid">
        <Stat label="HOÀN THÀNH" value={String(data.totals.completed)} note={`${data.totals.created} tạo · ${deltaLabel(completedDelta, 'việc hoàn tất')}`} icon={<Check size={16} />} />
        <Stat label="ĐÚNG HẠN" value={rate === null ? '—' : `${rate}%`} note={`${data.onTime.completedOnTime} đúng hạn · ${data.onTime.completedLate} trễ`} icon={<Target size={16} />} />
        <Stat label="THỜI GIAN TẬP TRUNG" value={durationLabel(data.focus.totalSeconds)} note={`${data.totals.remaining} việc mở · ${deltaLabel(Math.round(focusDelta / 60), 'phút')}`} icon={<Clock3 size={16} />} />
        <Stat label="CHUỖI HIỆN TẠI" value={`${data.streak.current} ngày`} note={`Dài nhất ${data.streak.longest} ngày`} icon={<Flame size={16} />} />
      </div>

      <div className="analytics-main-grid">
        <section className="analytics-panel analytics-completion-panel">
          <div className="analytics-panel-heading"><div><h2>Nhịp hoàn thành</h2><p>Số công việc hoàn tất theo ngày · tổng {data.totals.completed}</p></div><BarChart3 size={17} /></div>
          {data.completion.every((item) => item.count === 0) ? <p className="analytics-empty">Chưa có công việc hoàn thành trong khoảng này.</p> : <div className="completion-chart" role="img" aria-label={`Biểu đồ cột công việc hoàn thành theo ngày từ ${shortDate(data.range.startDate)} đến ${shortDate(data.range.endDate)}`}>
            {data.completion.map((item) => <div className="completion-column" key={item.date} title={`${shortDate(item.date)}: ${item.count} công việc`}><span className="completion-count">{item.count || ''}</span><span className="completion-track"><i style={{ height: `${Math.max(item.count ? 9 : 2, item.count / maxCompleted * 100)}%` }} /></span><time dateTime={item.date}>{new Intl.DateTimeFormat('vi-VN', { day: 'numeric' }).format(new Date(`${item.date}T12:00:00`))}</time></div>)}
          </div>}
          <div className="analytics-legend"><span><i className="legend-green" />Hoàn thành</span><span>{shortDate(data.range.startDate)} – {shortDate(data.range.endDate)}</span></div>
        </section>

        <section className="analytics-panel ontime-panel">
          <div className="analytics-panel-heading"><div><h2>Hoàn thành đúng hạn</h2><p>Ngày hoàn tất so với hạn cuối</p></div><Target size={17} /></div>
          <div className="ontime-content"><div className="ontime-ring" role="img" aria-label={rate === null ? 'Chưa có công việc đủ điều kiện tính tỷ lệ đúng hạn' : `Tỷ lệ hoàn thành đúng hạn ${rate}%`} style={{ background: `conic-gradient(var(--green) ${rate ?? 0}%, var(--line) 0)` }}><div><strong>{rate === null ? '—' : `${rate}%`}</strong><span>đúng hạn</span></div></div><div className="ontime-breakdown"><div><i className="legend-green" /><span>Đúng hạn</span><strong>{data.onTime.completedOnTime}</strong></div><div><i className="legend-coral" /><span>Hoàn thành trễ</span><strong>{data.onTime.completedLate}</strong></div><div><i className="legend-muted" /><span>Đang quá hạn</span><strong>{data.onTime.overdue}</strong></div></div></div>
          <p className="analytics-definition">Tính trên {data.onTime.eligible} việc đã hoàn tất có hạn trong kỳ. Không có hạn không được tính.</p>
        </section>
      </div>

      <div className="analytics-lower-grid">
        <section className="analytics-panel focus-chart-panel">
          <div className="analytics-panel-heading"><div><h2>Thời gian tập trung</h2><p>{focusView === 'daily' ? 'Tổng theo ngày lịch địa phương' : 'Tổng theo tuần, bắt đầu từ thứ Hai'}</p></div><div className="analytics-focus-heading-actions"><div className="analytics-period-switch" role="group" aria-label="Chế độ biểu đồ thời gian tập trung">{([['daily', 'Ngày'], ['weekly', 'Tuần']] as const).map(([key, label]) => <button key={key} className={focusView === key ? 'selected' : ''} aria-pressed={focusView === key} onClick={() => setFocusView(key)}>{label}</button>)}</div><Clock3 size={17} /></div></div>
          {focusEntries.every((item) => item.seconds === 0) ? <p className="analytics-empty">Chưa có phiên tập trung hoàn thành trong khoảng này.</p> : <div className="focus-chart" role="img" aria-label={`Biểu đồ tổng thời gian tập trung theo ${focusView === 'daily' ? 'ngày' : 'tuần'} trong khoảng đã chọn`}>{focusEntries.map((item) => {
            const maximum = Math.max(1, ...focusEntries.map((entry) => entry.seconds))
            return <div className="focus-column" key={item.key} title={`${item.label}: ${durationLabel(item.seconds)} trong khoảng đã chọn`}><span>{item.seconds ? durationLabel(item.seconds) : ''}</span><i style={{ height: `${Math.max(item.seconds ? 8 : 2, item.seconds / maximum * 100)}%` }} /><time>{item.label}</time></div>
          })}</div>}
          <div className="analytics-legend"><span><i className="legend-blue" />Thời gian focus</span><span>{durationLabel(data.focus.totalSeconds)} trong kỳ</span></div>
        </section>

        <section className="analytics-panel streak-panel">
          <div className="analytics-panel-heading"><div><h2>Hoạt động mỗi ngày</h2><p>Đạt mục tiêu khi hoàn thành ít nhất {dailyGoal} việc</p></div><Activity size={17} /></div>
          <label className="goal-control"><span>Mục tiêu ngày</span><input type="number" min="1" max="20" value={dailyGoal} onChange={(event) => setDailyGoal(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} aria-label="Số việc hoàn thành mỗi ngày để tính chuỗi" /></label>
          <div className="streak-numbers"><div><strong>{data.streak.current}</strong><span>chuỗi hiện tại</span></div><div><strong>{data.streak.longest}</strong><span>dài nhất</span></div></div>
          <div className="activity-grid" role="img" aria-label="Bản đồ hoạt động hoàn thành công việc 365 ngày qua">
            {data.streak.activity.map((item) => <span key={item.date} title={`${shortDate(item.date)}: ${item.count} việc`} data-level={item.count ? Math.min(4, Math.max(1, Math.ceil(item.count / dailyGoal))) : 0} />)}
          </div>
          <div className="analytics-legend"><span>Ít hơn</span><div className="heat-legend"><i data-level="0" /><i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" /></div><span>Nhiều hơn</span></div>
        </section>
      </div>

      {data.projects.length > 0 && <section className="analytics-panel project-analytics-panel"><div className="analytics-panel-heading"><div><h2>Năng suất theo dự án</h2><p>Công việc tạo và hoàn tất trong kỳ</p></div></div><div className="project-analytics-list">{data.projects.map((project) => <div key={project.id}><span className="project-analytics-name"><i style={{ background: project.color }} />{project.name}</span><span>{project.created} tạo</span><strong>{project.completed} xong</strong><span>{project.remaining} còn lại</span></div>)}</div></section>}

      <section className="analytics-panel pomodoro-panel">
        <div className="pomodoro-main">
          <div className="analytics-panel-heading"><div><h2>{breakActive && !session ? 'Thời gian nghỉ' : 'Đồng hồ Pomodoro'}</h2><p>Phiên tập trung được đo và lưu bởi máy chủ</p></div><TimerReset size={17} /></div>
          <div className={`pomodoro-clock ${session?.status === 'paused' ? 'is-paused' : ''}`} aria-live="off"><span>{minutes}</span><b>:</b><span>{seconds}</span></div>
          <p className="pomodoro-status" role="status">{session ? session.status === 'paused' ? 'Đang tạm dừng' : 'Đang tập trung' : breakActive ? 'Đang nghỉ' : 'Sẵn sàng bắt đầu'}</p>
          {timerError && <p className="task-error" role="alert">{timerError}</p>}
          <div className="pomodoro-actions">{session ? <>{session.status === 'running' ? <button className="primary-button" onClick={() => void sessionAction('pause')}><CirclePause size={16} />Tạm dừng</button> : <button className="primary-button" onClick={() => void sessionAction('resume')}><CirclePlay size={16} />Tiếp tục</button>}<button className="secondary-button" onClick={() => void sessionAction('interrupt')}><RotateCcw size={15} />Đặt lại phiên</button></> : breakActive ? <button className="secondary-button" onClick={stopBreak}><RotateCcw size={15} />Kết thúc nghỉ</button> : <><button className="primary-button" onClick={() => void startFocus()}><CirclePlay size={16} />Bắt đầu tập trung</button><button className="secondary-button" onClick={startBreak}><Clock3 size={15} />Bắt đầu nghỉ</button></>}</div>
        </div>
        <div className="pomodoro-settings">
          <label>Thời gian tập trung<input type="number" min="1" max="120" value={focusMinutes} disabled={Boolean(session)} onChange={(event) => setFocusMinutes(Math.max(1, Math.min(120, Number(event.target.value) || 1)))} /> phút</label>
          <label>Thời gian nghỉ<input type="number" min="1" max="60" value={breakMinutes} disabled={Boolean(session)} onChange={(event) => setBreakMinutes(Math.max(1, Math.min(60, Number(event.target.value) || 1)))} /> phút</label>
          <label>Công việc<select value={focusTaskId} disabled={Boolean(session)} onChange={(event) => { const taskId = event.target.value; setFocusTaskId(taskId); const task = tasks.find((entry) => entry.id === taskId); setFocusProjectId(task?.projectId ?? '') }}><option value="">Không gắn công việc</option>{tasks.filter((task) => !task.completed).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
          <label>Dự án<select value={focusProjectId} disabled={Boolean(session) || Boolean(focusTaskId)} onChange={(event) => setFocusProjectId(event.target.value)}><option value="">Không gắn dự án</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <p><Clock3 size={14} /> Phiên hoàn tất chỉ được ghi khi đủ thời lượng đã đặt. Phiên kết thúc sớm được lưu riêng và không cộng vào biểu đồ.</p>
        </div>
      </section>
      <p className="analytics-footnote">Chuỗi tính theo ngày địa phương có ít nhất {dailyGoal} việc hoàn tất; hôm nay hoặc hôm qua có thể là ngày cuối chuỗi. Task mở lại sẽ không còn tính trong lịch sử hoàn tất. Phiên focus được phân bổ theo từng đoạn chạy, không tính thời gian tạm dừng.</p>
    </>}
  </section>
}