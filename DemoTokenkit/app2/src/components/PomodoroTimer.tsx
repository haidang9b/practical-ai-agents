import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { Project, Task } from '../types';

interface FocusSession {
  id: string;
  taskId: string | null;
  projectId: string | null;
  startedAt: string;
  activeStartedAt: string | null;
  durationSeconds: number;
  expectedDurationSeconds: number;
  status: 'running' | 'paused' | 'completed' | 'interrupted';
}

interface BreakState {
  endsAt: number | null;
  pausedSeconds: number | null;
}

interface PomodoroTimerProps {
  userId: string;
  tasks: Task[];
  projects: Project[];
  onCompleted: () => void;
}

function readMinutes(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isInteger(value) && value >= 1 && value <= 120 ? value : fallback;
}

function readBreakState(key: string): BreakState | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as BreakState | null;
    if (value && (typeof value.endsAt === 'number' || value.endsAt === null) &&
      (typeof value.pausedSeconds === 'number' || value.pausedSeconds === null)) return value;
  } catch {
    return null;
  }
  return null;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export default function PomodoroTimer({ userId, tasks, projects, onCompleted }: PomodoroTimerProps) {
  const focusKey = `pomodoro:focus:${userId}`;
  const breakKey = `pomodoro:break:${userId}`;
  const breakStateKey = `pomodoro:break-state:${userId}`;
  const [focusMinutes, setFocusMinutes] = useState(() => readMinutes(focusKey, 25));
  const [breakMinutes, setBreakMinutes] = useState(() => readMinutes(breakKey, 5));
  const [breakState, setBreakState] = useState<BreakState | null>(() => readBreakState(breakStateKey));
  const [session, setSession] = useState<FocusSession | null>(null);
  const [selectedTask, setSelectedTask] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const completionPending = useRef(false);

  useEffect(() => {
    let active = true;
    apiRequest<{ session: FocusSession | null }>('/focus-sessions/active')
      .then(({ session: activeSession }) => { if (active) setSession(activeSession); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Chưa thể khôi phục phiên tập trung.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem(focusKey, String(focusMinutes));
    localStorage.setItem(breakKey, String(breakMinutes));
  }, [focusKey, focusMinutes, breakKey, breakMinutes]);

  useEffect(() => {
    if (breakState) localStorage.setItem(breakStateKey, JSON.stringify(breakState));
    else localStorage.removeItem(breakStateKey);
  }, [breakStateKey, breakState]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (breakState && breakState.endsAt !== null && breakState.endsAt <= now) setBreakState(null);
  }, [breakState, now]);

  const inBreak = !session && breakState !== null;
  const focusRemaining = session
    ? session.expectedDurationSeconds - session.durationSeconds - (session.status === 'running' && session.activeStartedAt ? Math.floor((now - Date.parse(session.activeStartedAt)) / 1000) : 0)
    : focusMinutes * 60;
  const breakRemaining = breakState
    ? breakState.endsAt === null ? breakState.pausedSeconds ?? 0 : Math.ceil((breakState.endsAt - now) / 1000)
    : breakMinutes * 60;
  const remaining = Math.max(0, inBreak ? breakRemaining : focusRemaining);

  useEffect(() => {
    if (!session || session.status !== 'running' || remaining > 0 || completionPending.current) return;
    completionPending.current = true;
    setBusy(true);
    apiRequest<{ session: FocusSession }>(`/focus-sessions/${encodeURIComponent(session.id)}/complete`, { method: 'POST' })
      .then(() => {
        setSession(null);
        setBreakState({ endsAt: Date.now() + breakMinutes * 60_000, pausedSeconds: null });
        setError('');
        onCompleted();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Chưa thể lưu phiên tập trung.'))
      .finally(() => setBusy(false));
  }, [session, remaining, breakMinutes, onCompleted]);

  async function startFocus() {
    setBusy(true);
    setError('');
    try {
      const { session: started } = await apiRequest<{ session: FocusSession }>('/focus-sessions', {
        method: 'POST',
        body: JSON.stringify({
          taskId: selectedTask || null,
          projectId: selectedTask ? null : selectedProject || null,
          expectedDurationSeconds: focusMinutes * 60,
        }),
      });
      completionPending.current = false;
      setSession(started);
      setBreakState(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa thể bắt đầu phiên tập trung.');
    } finally {
      setBusy(false);
    }
  }

  async function changeFocusState(action: 'pause' | 'resume') {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const { session: changed } = await apiRequest<{ session: FocusSession }>(`/focus-sessions/${encodeURIComponent(session.id)}/${action}`, { method: 'POST' });
      setSession(changed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật phiên tập trung.');
    } finally {
      setBusy(false);
    }
  }

  async function resetTimer() {
    setBusy(true);
    setError('');
    try {
      if (session) await apiRequest(`/focus-sessions/${encodeURIComponent(session.id)}/interrupt`, { method: 'POST' });
      completionPending.current = false;
      setSession(null);
      setBreakState(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể dừng phiên tập trung.');
    } finally {
      setBusy(false);
    }
  }

  async function retryCompletion() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/focus-sessions/${encodeURIComponent(session.id)}/complete`, { method: 'POST' });
      completionPending.current = false;
      setSession(null);
      setBreakState({ endsAt: Date.now() + breakMinutes * 60_000, pausedSeconds: null });
      onCompleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa thể lưu phiên tập trung.');
    } finally {
      setBusy(false);
    }
  }

  function pauseBreak() {
    setBreakState({ endsAt: null, pausedSeconds: remaining });
  }

  function resumeBreak() {
    setBreakState({ endsAt: Date.now() + remaining * 1000, pausedSeconds: null });
  }

  const task = tasks.find((item) => item.id === (session?.taskId ?? selectedTask));

  return (
    <section className="pomodoro-panel" aria-labelledby="pomodoro-heading">
      <div className="analytics-panel-heading">
        <div><p className="eyebrow">THỜI GIAN TẬP TRUNG</p><h2 id="pomodoro-heading">Đồng hồ Pomodoro</h2></div>
        <span className="timer-status">{loading ? 'Đang khôi phục' : inBreak ? 'Giờ nghỉ' : session ? session.status === 'paused' ? 'Đang tạm dừng' : 'Đang tập trung' : 'Sẵn sàng'}</span>
      </div>
      <div className={`timer-face ${inBreak ? 'timer-break' : ''}`}>
        <span className="timer-mode">{inBreak ? 'NGHỈ NGẮN' : 'TẬP TRUNG'}</span>
        <strong aria-live="polite" aria-label={`${Math.floor(remaining / 60)} phút ${remaining % 60} giây còn lại`}>{formatTime(remaining)}</strong>
        <span>{task ? `Đang làm: ${task.title}` : session?.projectId ? projects.find((project) => project.id === session.projectId)?.name ?? 'Phiên tập trung' : 'Dành trọn một khoảng cho việc quan trọng'}</span>
      </div>
      <div className="timer-settings">
        <label>Tập trung <input type="number" min="1" max="120" value={focusMinutes} disabled={Boolean(session) || busy} onChange={(event) => setFocusMinutes(Math.max(1, Math.min(120, Number(event.target.value) || 1)))} /> phút</label>
        <label>Nghỉ <input type="number" min="1" max="120" value={breakMinutes} disabled={busy} onChange={(event) => setBreakMinutes(Math.max(1, Math.min(120, Number(event.target.value) || 1)))} /> phút</label>
      </div>
      {!session && !inBreak && <div className="timer-associations">
        <label><span className="sr-only">Gắn phiên vào công việc</span><select aria-label="Gắn phiên vào công việc" value={selectedTask} disabled={busy} onChange={(event) => { setSelectedTask(event.target.value); const next = tasks.find((item) => item.id === event.target.value); setSelectedProject(next?.projectId ?? ''); }}>
          <option value="">Không gắn công việc</option>{tasks.filter((item) => !item.completed).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        {!selectedTask && <label><span className="sr-only">Gắn phiên vào dự án</span><select aria-label="Gắn phiên vào dự án" value={selectedProject} disabled={busy} onChange={(event) => setSelectedProject(event.target.value)}>
          <option value="">Không gắn dự án</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>}
      </div>}
      <div className="timer-actions">
        {!session && !inBreak && <button className="primary-button" disabled={loading || busy} onClick={() => void startFocus()}><Play size={15} />Bắt đầu tập trung</button>}
        {session && <button className="primary-button" disabled={busy} onClick={() => void changeFocusState(session.status === 'running' ? 'pause' : 'resume')}>
          {session.status === 'running' ? <Pause size={15} /> : <Play size={15} />}{session.status === 'running' ? 'Tạm dừng' : 'Tiếp tục'}
        </button>}
        {inBreak && <button className="primary-button" disabled={busy} onClick={breakState?.endsAt === null ? resumeBreak : pauseBreak}>
          {breakState?.endsAt === null ? <Play size={15} /> : <Pause size={15} />}{breakState?.endsAt === null ? 'Tiếp tục nghỉ' : 'Tạm dừng nghỉ'}
        </button>}
        {(session || inBreak) && <button className="timer-reset" disabled={busy} onClick={() => void resetTimer()} aria-label="Dừng và đặt lại đồng hồ" title="Dừng và đặt lại"><RotateCcw size={15} /></button>}
      </div>
      {error && <p className="analytics-error" role="alert">{error}</p>}
      {session && remaining === 0 && error && <button className="text-button timer-retry" disabled={busy} onClick={() => void retryCompletion()}>Thử lưu phiên lần nữa</button>}
      {session && <p className="timer-policy">Chỉ phiên hoàn thành đủ {Math.round(session.expectedDurationSeconds / 60)} phút mới được ghi vào thống kê. Đặt lại sẽ đánh dấu phiên gián đoạn.</p>}
    </section>
  );
}