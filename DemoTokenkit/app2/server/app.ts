import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import { buildAnalytics } from './analytics';
import { habitStatistics, type HabitRecord } from './habits';

const refreshCookie = 'refreshToken';
const refreshLifetimeSeconds = 7 * 24 * 60 * 60;

interface User {
  id: string;
  email: string;
}

interface AuthOptions {
  database: Database.Database;
  accessSecret: string;
  refreshSecret: string;
  secureCookies?: boolean;
}

interface AccessRequest extends Request {
  user?: User;
}

interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  tasks: string[];
}

const projectTemplates: ProjectTemplate[] = [
  { id: 'study', name: 'Dự án học tập', description: 'Lập kế hoạch và theo dõi hành trình học tập.', color: '#56846c', tasks: ['Xác định mục tiêu học tập', 'Lập lịch học', 'Hoàn thành buổi học', 'Đánh giá tiến độ học tập'] },
  { id: 'work', name: 'Dự án công việc', description: 'Tổ chức mục tiêu và bàn giao công việc.', color: '#df634d', tasks: ['Xác định mục tiêu', 'Phân tích yêu cầu', 'Triển khai công việc', 'Rà soát kết quả bàn giao', 'Hoàn tất dự án'] },
  { id: 'personal', name: 'Dự án cá nhân', description: 'Biến mục tiêu cá nhân thành kế hoạch hành động.', color: '#c18a36', tasks: ['Xác định mục tiêu cá nhân', 'Tạo kế hoạch hành động', 'Theo dõi tiến độ', 'Đánh giá kết quả'] },
];

function validText(value: unknown, maximum = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
}

function validTaskFields(task: Record<string, unknown>, partial: boolean): boolean {
  if (!partial && !validText(task.title, 500) || task.title !== undefined && !validText(task.title, 500)) return false;
  if (task.description !== undefined && (typeof task.description !== 'string' || task.description.length > 5000)) return false;
  if (task.category !== undefined && (typeof task.category !== 'string' || task.category.length > 120)) return false;
  if (task.project !== undefined && (typeof task.project !== 'string' || task.project.length > 120)) return false;
  if (task.dueDate !== undefined && (typeof task.dueDate !== 'string' || task.dueDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))) return false;
  if (task.scheduledAt !== undefined && (typeof task.scheduledAt !== 'string' || task.scheduledAt !== '' && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(task.scheduledAt))) return false;
  if (task.priority !== undefined && !['low', 'medium', 'high'].includes(String(task.priority))) return false;
  if (task.status !== undefined && !['todo', 'in_progress', 'done'].includes(String(task.status))) return false;
  if (task.projectId !== undefined && task.projectId !== null && typeof task.projectId !== 'string') return false;
  if (task.tags !== undefined && (!Array.isArray(task.tags) || task.tags.length > 30 || task.tags.some((tag) => typeof tag !== 'string' || tag.length > 60))) return false;
  return true;
}

function mapTask(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    dueDate: row.due_date,
    scheduledAt: row.scheduled_at,
    status: row.status,
    completed: Boolean(row.completed),
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    project: row.project_name ?? row.legacy_project,
    projectId: row.project_id,
    tags: JSON.parse(String(row.tags || '[]')) as string[],
  };
}

function mapSubtask(row: Record<string, unknown>) {
  return { id: row.id, taskId: row.task_id, title: row.title, completed: Boolean(row.completed), position: row.position, createdAt: row.created_at, updatedAt: row.updated_at };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueAccessToken(user: User, secret: string): string {
  return jwt.sign({ type: 'access', email: user.email }, secret, { subject: user.id, expiresIn: '15m' });
}

function setRefreshCookie(response: Response, token: string, secure: boolean): void {
  response.cookie(refreshCookie, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: refreshLifetimeSeconds * 1000,
  });
}

export function createApp(options: AuthOptions) {
  const { database, accessSecret, refreshSecret, secureCookies = false } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Có quá nhiều lần thử. Vui lòng đợi 15 phút.' },
  });

  function createSession(response: Response, user: User): string {
    const tokenId = randomUUID();
    const token = jwt.sign({ type: 'refresh' }, refreshSecret, {
      subject: user.id,
      jwtid: tokenId,
      expiresIn: refreshLifetimeSeconds,
    });
    database.prepare('INSERT INTO refresh_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), user.id, Date.now() + refreshLifetimeSeconds * 1000, new Date().toISOString());
    setRefreshCookie(response, token, secureCookies);
    return issueAccessToken(user, accessSecret);
  }

  function authenticate(request: AccessRequest, response: Response, next: NextFunction): void {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) {
      response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
      return;
    }
    try {
      const payload = jwt.verify(token, accessSecret) as JwtPayload;
      if (payload.type !== 'access' || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
        return;
      }
      request.user = { id: payload.sub, email: payload.email };
      next();
    } catch {
      response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
    }
  }

  app.post('/api/auth/register', credentialLimiter, async (request, response, next) => {
    try {
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response.status(400).json({ error: 'Vui lòng nhập email hợp lệ.' });
        return;
      }
      if (password.length < 10 || password.length > 128) {
        response.status(400).json({ error: 'Mật khẩu cần có từ 10 đến 128 ký tự.' });
        return;
      }
      const user: User = { id: randomUUID(), email };
      try {
        database.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
          .run(user.id, user.email, await bcrypt.hash(password, 12), new Date().toISOString());
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          response.status(409).json({ error: 'Địa chỉ email này đã được đăng ký.' });
          return;
        }
        throw error;
      }
      response.status(201).json({ accessToken: createSession(response, user), user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', credentialLimiter, async (request, response, next) => {
    try {
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const row = database.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email) as
        { id: string; email: string; password_hash: string } | undefined;
      if (!row || !(await bcrypt.compare(password, row.password_hash))) {
        response.status(401).json({ error: 'Email hoặc mật khẩu chưa chính xác.' });
        return;
      }
      const user: User = { id: row.id, email: row.email };
      response.json({ accessToken: createSession(response, user), user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/refresh', (request, response) => {
    const token = request.cookies?.[refreshCookie] as string | undefined;
    if (!token) {
      response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
      return;
    }
    try {
      const payload = jwt.verify(token, refreshSecret) as JwtPayload;
      const tokenHash = hashToken(token);
      const row = database.prepare(`SELECT users.id, users.email FROM refresh_sessions
        INNER JOIN users ON users.id = refresh_sessions.user_id
        WHERE refresh_sessions.token_hash = ? AND refresh_sessions.expires_at > ?`)
        .get(tokenHash, Date.now()) as User | undefined;
      if (payload.type !== 'refresh' || typeof payload.sub !== 'string' || row?.id !== payload.sub) {
        response.clearCookie(refreshCookie, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/auth' });
        response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
        return;
      }
      const rotate = database.transaction(() => {
        const removed = database.prepare('DELETE FROM refresh_sessions WHERE token_hash = ?').run(tokenHash);
        if (removed.changes !== 1) return null;
        return createSession(response, row);
      });
      const accessToken = rotate();
      if (!accessToken) {
        response.status(401).json({ error: 'Phiên đăng nhập đã được sử dụng.' });
        return;
      }
      response.json({ accessToken, user: row });
    } catch {
      response.clearCookie(refreshCookie, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/auth' });
      response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
    }
  });

  app.post('/api/auth/logout', (request, response) => {
    const token = request.cookies?.[refreshCookie] as string | undefined;
    if (token) database.prepare('DELETE FROM refresh_sessions WHERE token_hash = ?').run(hashToken(token));
    response.clearCookie(refreshCookie, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/auth' });
    response.status(204).end();
  });

  app.get('/api/auth/me', authenticate, (request: AccessRequest, response) => {
    response.json({ user: request.user });
  });

  const localToday = () => {
    const now = new Date();
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
  };
  const localDateAt = (date: Date, timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const isDateKey = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const shiftDateKey = (value: string, amount: number) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };
  const findOwnedTask = (taskId: string, userId: string) => database.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  const findOwnedProject = (projectId: string, userId: string) => database.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  const findOwnedHabit = (habitId: string, userId: string) => database.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(habitId, userId) as (HabitRecord & Record<string, unknown>) | undefined;
  const mapHabit = (row: HabitRecord & Record<string, unknown>) => ({
    id: row.id, name: row.name, description: row.description, category: row.category, icon: row.icon, color: row.color,
    frequency: row.frequency, weeklyTarget: row.weekly_target, startDate: row.start_date, endDate: row.end_date,
    archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at,
  });
  const habitTimeZone = (request: Request, response: Response) => {
    const timeZone = typeof request.query.timeZone === 'string' ? request.query.timeZone : 'Asia/Ho_Chi_Minh';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      response.status(400).json({ error: 'Múi giờ chưa hợp lệ.' });
      return null;
    }
  };
  const habitRange = (request: Request, response: Response, today: string) => {
    const to = request.query.to === undefined ? today : request.query.to;
    const from = request.query.from === undefined && isDateKey(to) ? shiftDateKey(to, -89) : request.query.from;
    if (!isDateKey(from) || !isDateKey(to) || from > to || (Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86400000 > 365) {
      response.status(400).json({ error: 'Khoảng ngày cần hợp lệ và không dài quá 366 ngày.' });
      return null;
    }
    return { from, to };
  };
  const selectTask = `SELECT tasks.*, projects.name AS project_name FROM tasks
    LEFT JOIN projects ON projects.id = tasks.project_id`;

  app.get('/api/habits', authenticate, (request: AccessRequest, response) => {
    const archived = request.query.archived === 'true' ? 1 : request.query.archived === 'false' ? 0 : null;
    const rows = archived === null
      ? database.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY archived, created_at DESC').all(request.user!.id)
      : database.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = ? ORDER BY created_at DESC').all(request.user!.id, archived);
    response.json({ habits: rows.map((row) => mapHabit(row as HabitRecord & Record<string, unknown>)) });
  });

  app.get('/api/habits/:id', authenticate, (request: AccessRequest, response) => {
    const habitId = String(request.params.id);
    const habit = findOwnedHabit(habitId, request.user!.id);
    if (!habit) {
      response.status(404).json({ error: 'Không tìm thấy thói quen.' });
      return;
    }
    response.json({ habit: mapHabit(habit) });
  });

  app.post('/api/habits', authenticate, (request: AccessRequest, response) => {
    const body = request.body ?? {};
    const frequency = body.frequency ?? 'daily';
    const weeklyTarget = body.weeklyTarget ?? 1;
    const startDate = body.startDate ?? localToday();
    const endDate = body.endDate ?? '';
    if (!validText(body.name, 120) || body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)
      || body.category !== undefined && (typeof body.category !== 'string' || body.category.length > 80)
      || body.icon !== undefined && (typeof body.icon !== 'string' || body.icon.length > 16)
      || body.color !== undefined && (typeof body.color !== 'string' || !/^#[\da-f]{6}$/i.test(body.color))
      || !['daily', 'weekly'].includes(frequency) || !Number.isInteger(weeklyTarget) || weeklyTarget < 1 || weeklyTarget > 7
      || !isDateKey(startDate) || endDate !== '' && (!isDateKey(endDate) || endDate < startDate)) {
      response.status(400).json({ error: 'Thông tin thói quen chưa hợp lệ.' });
      return;
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    database.prepare(`INSERT INTO habits (id, user_id, name, description, category, icon, color, frequency, weekly_target,
      start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, request.user!.id, body.name.trim(), String(body.description ?? '').trim(), String(body.category ?? 'Cá nhân').trim() || 'Cá nhân',
        body.icon ?? '✨', body.color ?? '#56846c', frequency, weeklyTarget, startDate, endDate, now, now);
    response.status(201).json({ habit: mapHabit(findOwnedHabit(id, request.user!.id)!) });
  });

  app.patch('/api/habits/:id', authenticate, (request: AccessRequest, response) => {
    const habitId = String(request.params.id);
    const current = findOwnedHabit(habitId, request.user!.id);
    if (!current) {
      response.status(404).json({ error: 'Không tìm thấy thói quen.' });
      return;
    }
    const body = request.body ?? {};
    if (body.name !== undefined && !validText(body.name, 120) || body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)
      || body.category !== undefined && (typeof body.category !== 'string' || body.category.length > 80)
      || body.icon !== undefined && (typeof body.icon !== 'string' || body.icon.length > 16)
      || body.color !== undefined && (typeof body.color !== 'string' || !/^#[\da-f]{6}$/i.test(body.color))
      || body.frequency !== undefined && !['daily', 'weekly'].includes(body.frequency)
      || body.weeklyTarget !== undefined && (!Number.isInteger(body.weeklyTarget) || body.weeklyTarget < 1 || body.weeklyTarget > 7)
      || body.startDate !== undefined && !isDateKey(body.startDate)
      || body.endDate !== undefined && body.endDate !== '' && !isDateKey(body.endDate)
      || body.archived !== undefined && typeof body.archived !== 'boolean') {
      response.status(400).json({ error: 'Thông tin thói quen chưa hợp lệ.' });
      return;
    }
    const startDate = body.startDate ?? current.start_date;
    const endDate = body.endDate ?? current.end_date;
    if (endDate && endDate < startDate) {
      response.status(400).json({ error: 'Ngày kết thúc không thể trước ngày bắt đầu.' });
      return;
    }
    database.prepare(`UPDATE habits SET name = ?, description = ?, category = ?, icon = ?, color = ?, frequency = ?,
      weekly_target = ?, start_date = ?, end_date = ?, archived = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(body.name?.trim() ?? current.name, body.description?.trim() ?? current.description, body.category?.trim() ?? current.category,
        body.icon ?? current.icon, body.color ?? current.color, body.frequency ?? current.frequency, body.weeklyTarget ?? current.weekly_target,
        startDate, endDate, body.archived === undefined ? current.archived : Number(body.archived), new Date().toISOString(), habitId, request.user!.id);
    response.json({ habit: mapHabit(findOwnedHabit(habitId, request.user!.id)!) });
  });

  app.delete('/api/habits/:id', authenticate, (request: AccessRequest, response) => {
    const result = database.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(request.params.id, request.user!.id);
    if (!result.changes) {
      response.status(404).json({ error: 'Không tìm thấy thói quen.' });
      return;
    }
    response.status(204).end();
  });

  app.post('/api/habits/:id/archive', authenticate, (request: AccessRequest, response) => {
    const habitId = String(request.params.id);
    const current = findOwnedHabit(habitId, request.user!.id);
    if (!current) {
      response.status(404).json({ error: 'Không tìm thấy thói quen.' });
      return;
    }
    database.prepare('UPDATE habits SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(new Date().toISOString(), habitId, request.user!.id);
    response.json({ habit: mapHabit(findOwnedHabit(habitId, request.user!.id)!) });
  });

  app.get('/api/habits/:id/completions', authenticate, (request: AccessRequest, response) => {
    const habitId = String(request.params.id);
    const habit = findOwnedHabit(habitId, request.user!.id);
    if (!habit) {
      response.status(404).json({ error: 'Không tìm thấy thói quen.' });
      return;
    }
    const timeZone = habitTimeZone(request, response);
    if (!timeZone) return;
    const today = localDateAt(new Date(), timeZone);
    const range = habitRange(request, response, today);
    if (!range) return;
    const completions = database.prepare(`SELECT completion_date AS date, created_at AS createdAt, updated_at AS updatedAt
      FROM habit_completions WHERE habit_id = ? AND user_id = ? AND completion_date BETWEEN ? AND ? ORDER BY completion_date`)
      .all(habitId, request.user!.id, range.from, range.to);
    response.json({ completions });
  });

  app.put('/api/habits/:id/completions/:date', authenticate, (request: AccessRequest, response) => {
    const habitId = String(request.params.id);
    const habit = findOwnedHabit(habitId, request.user!.id);
    if (!habit) {
      response.status(404).json({ error: 'Không tìm thấy thói quen.' });
      return;
    }
    const timeZone = habitTimeZone(request, response);
    if (!timeZone) return;
    const date = request.params.date;
    if (!isDateKey(date) || date > localDateAt(new Date(), timeZone) || date < habit.start_date || habit.end_date && date > habit.end_date || habit.archived) {
      response.status(400).json({ error: 'Ngày hoàn thành không hợp lệ hoặc thói quen đã lưu trữ.' });
      return;
    }
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO habit_completions (id, habit_id, user_id, completion_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(habit_id, completion_date) DO UPDATE SET updated_at = excluded.updated_at`)
      .run(randomUUID(), habitId, request.user!.id, date, now, now);
    response.status(200).json({ completed: true, date });
  });

  app.delete('/api/habits/:id/completions/:date', authenticate, (request: AccessRequest, response) => {
    const habitId = String(request.params.id);
    if (!findOwnedHabit(habitId, request.user!.id)) {
      response.status(404).json({ error: 'Không tìm thấy thói quen.' });
      return;
    }
    if (!isDateKey(request.params.date)) {
      response.status(400).json({ error: 'Ngày hoàn thành chưa hợp lệ.' });
      return;
    }
    database.prepare('DELETE FROM habit_completions WHERE habit_id = ? AND user_id = ? AND completion_date = ?')
      .run(habitId, request.user!.id, request.params.date);
    response.status(204).end();
  });

  app.get('/api/habit-analytics/summary', authenticate, (request: AccessRequest, response) => {
    const timeZone = habitTimeZone(request, response);
    if (!timeZone) return;
    const today = localDateAt(new Date(), timeZone);
    const rows = database.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY archived, created_at DESC').all(request.user!.id) as Array<HabitRecord & Record<string, unknown>>;
    const completionRows = database.prepare('SELECT habit_id, completion_date FROM habit_completions WHERE user_id = ? AND completion_date <= ?')
      .all(request.user!.id, today) as Array<{ habit_id: string; completion_date: string }>;
    const byHabit = new Map<string, string[]>();
    for (const row of completionRows) byHabit.set(row.habit_id, [...(byHabit.get(row.habit_id) ?? []), row.completion_date]);
    const habits = rows.map((row) => {
      const statistics = habitStatistics(row, byHabit.get(row.id) ?? [], today);
      return { ...mapHabit(row), ...statistics };
    });
    const active = habits.filter((habit) => !habit.archived && habit.startDate <= today && (!habit.endDate || habit.endDate >= today));
    const completedToday = active.filter((habit) => (byHabit.get(habit.id) ?? []).includes(today)).length;
    response.json({ summary: { today, completedToday, activeToday: active.length, completionRate: active.length ? Math.round(completedToday / active.length * 100) : 0, habits } });
  });

  app.get('/api/habit-analytics/history', authenticate, (request: AccessRequest, response) => {
    const timeZone = habitTimeZone(request, response);
    if (!timeZone) return;
    const today = localDateAt(new Date(), timeZone);
    const range = habitRange(request, response, today);
    if (!range) return;
    const completions = database.prepare(`SELECT habit_id AS habitId, completion_date AS date FROM habit_completions
      WHERE user_id = ? AND completion_date BETWEEN ? AND ? ORDER BY completion_date`)
      .all(request.user!.id, range.from, range.to);
    response.json({ from: range.from, to: range.to, completions });
  });

  app.get('/api/projects', authenticate, (request: AccessRequest, response) => {
    const projects = database.prepare(`SELECT projects.*,
      COUNT(tasks.id) AS total_count,
      COALESCE(SUM(CASE WHEN tasks.completed = 0 THEN 1 ELSE 0 END), 0) AS active_count,
      COALESCE(SUM(CASE WHEN tasks.completed = 1 THEN 1 ELSE 0 END), 0) AS completed_count,
      COALESCE(SUM(CASE WHEN tasks.completed = 0 AND tasks.due_date <> '' AND tasks.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count
      FROM projects LEFT JOIN tasks ON tasks.project_id = projects.id AND tasks.user_id = projects.user_id
      WHERE projects.user_id = ? GROUP BY projects.id ORDER BY projects.created_at DESC`)
      .all(localToday(), request.user!.id);
    response.json({ projects });
  });

  app.get('/api/projects/:id', authenticate, (request: AccessRequest, response) => {
    const project = database.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(request.params.id, request.user!.id) as Record<string, unknown> | undefined;
    if (!project) {
      response.status(404).json({ error: 'Không tìm thấy dự án.' });
      return;
    }
    const tasks = database.prepare(`${selectTask} WHERE tasks.project_id = ? AND tasks.user_id = ? ORDER BY tasks.created_at DESC`)
      .all(request.params.id, request.user!.id).map((row) => mapTask(row as Record<string, unknown>));
    response.json({ project, tasks });
  });

  app.post('/api/projects', authenticate, (request: AccessRequest, response) => {
    const { name, description = '', color = '#56846c' } = request.body ?? {};
    if (!validText(name, 120) || typeof description !== 'string' || description.length > 2000 || typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) {
      response.status(400).json({ error: 'Tên, mô tả hoặc màu dự án chưa hợp lệ.' });
      return;
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    database.prepare('INSERT INTO projects (id, user_id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, request.user!.id, name.trim(), description.trim(), color, now, now);
    response.status(201).json({ project: database.prepare('SELECT * FROM projects WHERE id = ?').get(id) });
  });

  app.patch('/api/projects/:id', authenticate, (request: AccessRequest, response) => {
    const current = database.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(request.params.id, request.user!.id) as Record<string, unknown> | undefined;
    if (!current) {
      response.status(404).json({ error: 'Không tìm thấy dự án.' });
      return;
    }
    const body = request.body ?? {};
    if (body.name !== undefined && !validText(body.name, 120) || body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000) || body.color !== undefined && (typeof body.color !== 'string' || !/^#[\da-f]{6}$/i.test(body.color)) || body.archived !== undefined && typeof body.archived !== 'boolean') {
      response.status(400).json({ error: 'Thông tin dự án chưa hợp lệ.' });
      return;
    }
    database.prepare('UPDATE projects SET name = ?, description = ?, color = ?, archived = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(body.name?.trim() ?? current.name, body.description?.trim() ?? current.description, body.color ?? current.color,
        body.archived === undefined ? current.archived : Number(body.archived), new Date().toISOString(), request.params.id, request.user!.id);
    response.json({ project: database.prepare('SELECT * FROM projects WHERE id = ?').get(request.params.id) });
  });

  app.delete('/api/projects/:id', authenticate, (request: AccessRequest, response) => {
    const projectId = String(request.params.id);
    const userId = request.user!.id;
    if (!findOwnedProject(projectId, userId)) {
      response.status(404).json({ error: 'Không tìm thấy dự án.' });
      return;
    }
    const disposition = request.query.tasks;
    const taskCount = (database.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND user_id = ?').get(projectId, userId) as { count: number }).count;
    if (taskCount && disposition !== 'unassign' && disposition !== 'delete') {
      response.status(400).json({ error: 'Hãy chọn chuyển công việc sang chưa phân loại hoặc xóa chúng.' });
      return;
    }
    const remove = database.transaction(() => {
      if (disposition === 'delete') database.prepare('DELETE FROM tasks WHERE project_id = ? AND user_id = ?').run(projectId, userId);
      else database.prepare('UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ? AND user_id = ?').run(new Date().toISOString(), projectId, userId);
      database.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(projectId, userId);
    });
    remove();
    response.status(204).end();
  });

  app.get('/api/project-templates', authenticate, (_request, response) => response.json({ templates: projectTemplates }));

  app.post('/api/projects/from-template', authenticate, (request: AccessRequest, response) => {
    const { templateId, name, description, color } = request.body ?? {};
    const template = projectTemplates.find((item) => item.id === templateId);
    if (!template || !validText(name, 120) || description !== undefined && (typeof description !== 'string' || description.length > 2000) || color !== undefined && (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color))) {
      response.status(400).json({ error: 'Mẫu hoặc thông tin dự án chưa hợp lệ.' });
      return;
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const create = database.transaction(() => {
      database.prepare('INSERT INTO projects (id, user_id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, request.user!.id, name.trim(), typeof description === 'string' ? description.trim() : template.description, color ?? template.color, now, now);
      const insertTask = database.prepare(`INSERT INTO tasks (id, user_id, project_id, title, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const title of template.tasks) insertTask.run(randomUUID(), request.user!.id, id, title, template.name, now, now);
    });
    create();
    response.status(201).json({ project: database.prepare('SELECT * FROM projects WHERE id = ?').get(id) });
  });

  app.get('/api/tasks', authenticate, (request: AccessRequest, response) => {
    const projectId = typeof request.query.projectId === 'string' ? request.query.projectId : '';
    const query = projectId === 'unassigned'
      ? `${selectTask} WHERE tasks.user_id = ? AND tasks.project_id IS NULL ORDER BY tasks.created_at DESC`
      : projectId
        ? `${selectTask} WHERE tasks.user_id = ? AND tasks.project_id = ? ORDER BY tasks.created_at DESC`
        : `${selectTask} WHERE tasks.user_id = ? ORDER BY tasks.created_at DESC`;
    const parameters = projectId === 'unassigned' ? [request.user!.id] : projectId ? [request.user!.id, projectId] : [request.user!.id];
    response.json({ tasks: database.prepare(query).all(...parameters).map((row) => mapTask(row as Record<string, unknown>)) });
  });

  app.post('/api/tasks/import', authenticate, (request: AccessRequest, response) => {
    const tasks = request.body?.tasks;
    if (!Array.isArray(tasks) || tasks.length > 500 || tasks.some((task) => !validText(task?.id, 100) || !validText(task?.title, 500))) {
      response.status(400).json({ error: 'Danh sách công việc nhập vào chưa hợp lệ.' });
      return;
    }
    const insert = database.prepare(`INSERT INTO tasks (id, user_id, title, description, category, priority, due_date,
      scheduled_at, status, completed, legacy_project, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, category = excluded.category,
      priority = excluded.priority, due_date = excluded.due_date, scheduled_at = excluded.scheduled_at, status = excluded.status,
      completed = excluded.completed, legacy_project = excluded.legacy_project, tags = excluded.tags, updated_at = excluded.updated_at
      WHERE tasks.user_id = excluded.user_id`);
    const importTasks = database.transaction(() => {
      const now = new Date().toISOString();
      for (const task of tasks) {
        const status = ['todo', 'in_progress', 'done'].includes(task.status) ? task.status : task.completed ? 'done' : 'todo';
        const tags = Array.isArray(task.tags) ? JSON.stringify(task.tags.filter((tag: unknown) => typeof tag === 'string')) : '[]';
        insert.run(task.id, request.user!.id, task.title.trim(), String(task.description ?? ''), String(task.category ?? 'Công việc'),
          ['low', 'medium', 'high'].includes(task.priority) ? task.priority : 'medium', String(task.dueDate ?? ''), String(task.scheduledAt ?? ''), status,
          Number(status === 'done'), String(task.project ?? ''), tags, String(task.createdAt ?? now), now);
      }
    });
    importTasks();
    response.status(200).json({ imported: tasks.length });
  });

  app.post('/api/tasks', authenticate, (request: AccessRequest, response) => {
    const task = request.body ?? {};
    if (!validTaskFields(task, false) || !['low', 'medium', 'high'].includes(task.priority) || !['todo', 'in_progress', 'done'].includes(task.status)) {
      response.status(400).json({ error: 'Thông tin công việc chưa hợp lệ.' });
      return;
    }
    const projectId = typeof task.projectId === 'string' && task.projectId ? task.projectId : null;
    if (projectId && !findOwnedProject(projectId, request.user!.id)) {
      response.status(404).json({ error: 'Không tìm thấy dự án được chọn.' });
      return;
    }
    const id = typeof task.id === 'string' ? task.id : randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO tasks (id, user_id, project_id, title, description, category, priority, due_date, scheduled_at,
      status, completed, completed_at, legacy_project, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, request.user!.id, projectId, task.title.trim(), String(task.description ?? ''), String(task.category ?? 'Công việc'), task.priority,
        String(task.dueDate ?? ''), String(task.scheduledAt ?? ''), task.status, Number(task.status === 'done'), task.status === 'done' ? now : null, String(task.project ?? ''),
        JSON.stringify(Array.isArray(task.tags) ? task.tags.filter((tag: unknown) => typeof tag === 'string') : []), now, now);
    response.status(201).json({ task: mapTask(database.prepare(`${selectTask} WHERE tasks.id = ? AND tasks.user_id = ?`).get(id, request.user!.id) as Record<string, unknown>) });
  });

  app.patch('/api/tasks/:id', authenticate, (request: AccessRequest, response) => {
    const current = database.prepare(`${selectTask} WHERE tasks.id = ? AND tasks.user_id = ?`).get(request.params.id, request.user!.id) as Record<string, unknown> | undefined;
    if (!current) {
      response.status(404).json({ error: 'Không tìm thấy công việc.' });
      return;
    }
    const body = request.body ?? {};
    if (!validTaskFields(body, true)) {
      response.status(400).json({ error: 'Thông tin công việc chưa hợp lệ.' });
      return;
    }
    const projectId = body.projectId === undefined ? current.project_id : body.projectId || null;
    if (projectId && !findOwnedProject(projectId, request.user!.id)) {
      response.status(404).json({ error: 'Không tìm thấy dự án được chọn.' });
      return;
    }
    const status = body.status ?? current.status;
    const wasCompleted = Boolean(current.completed);
    const isCompleted = status === 'done';
    const completedAt = isCompleted ? (wasCompleted ? current.completed_at : new Date().toISOString()) : null;
    database.prepare(`UPDATE tasks SET project_id = ?, title = ?, description = ?, category = ?, priority = ?, due_date = ?, scheduled_at = ?,
      status = ?, completed = ?, completed_at = ?, legacy_project = ?, tags = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(projectId, body.title?.trim() ?? current.title, body.description ?? current.description, body.category ?? current.category,
        body.priority ?? current.priority, body.dueDate ?? current.due_date, body.scheduledAt ?? current.scheduled_at, status,
        Number(isCompleted), completedAt, body.project ?? current.legacy_project, JSON.stringify(body.tags ?? JSON.parse(String(current.tags))), new Date().toISOString(), request.params.id, request.user!.id);
    response.json({ task: mapTask(database.prepare(`${selectTask} WHERE tasks.id = ? AND tasks.user_id = ?`).get(request.params.id, request.user!.id) as Record<string, unknown>) });
  });

  app.delete('/api/tasks/:id', authenticate, (request: AccessRequest, response) => {
    const result = database.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(request.params.id, request.user!.id);
    if (!result.changes) {
      response.status(404).json({ error: 'Không tìm thấy công việc.' });
      return;
    }
    response.status(204).end();
  });

  app.get('/api/tasks/:taskId/subtasks', authenticate, (request: AccessRequest, response) => {
    if (!findOwnedTask(String(request.params.taskId), request.user!.id)) {
      response.status(404).json({ error: 'Không tìm thấy công việc.' });
      return;
    }
    const subtasks = database.prepare('SELECT subtasks.* FROM subtasks JOIN tasks ON tasks.id = subtasks.task_id WHERE subtasks.task_id = ? AND tasks.user_id = ? ORDER BY subtasks.position, subtasks.created_at')
      .all(request.params.taskId, request.user!.id).map((row) => mapSubtask(row as Record<string, unknown>));
    response.json({ subtasks });
  });

  app.post('/api/tasks/:taskId/subtasks', authenticate, (request: AccessRequest, response) => {
    if (!findOwnedTask(String(request.params.taskId), request.user!.id)) {
      response.status(404).json({ error: 'Không tìm thấy công việc.' });
      return;
    }
    if (!validText(request.body?.title, 300)) {
      response.status(400).json({ error: 'Tên việc con không được để trống và tối đa 300 ký tự.' });
      return;
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const position = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM subtasks WHERE task_id = ?').get(request.params.taskId) as { next: number }).next;
    database.prepare('INSERT INTO subtasks (id, task_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, request.params.taskId, request.body.title.trim(), position, now, now);
    response.status(201).json({ subtask: mapSubtask(database.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as Record<string, unknown>) });
  });

  app.patch('/api/tasks/:taskId/subtasks/reorder', authenticate, (request: AccessRequest, response) => {
    if (!findOwnedTask(String(request.params.taskId), request.user!.id)) {
      response.status(404).json({ error: 'Không tìm thấy công việc.' });
      return;
    }
    const ids = request.body?.ids;
    const rows = database.prepare('SELECT id FROM subtasks WHERE task_id = ?').all(request.params.taskId) as Array<{ id: string }>;
    if (!Array.isArray(ids) || ids.length !== rows.length || new Set(ids).size !== rows.length || ids.some((id: unknown) => !rows.some((row) => row.id === id))) {
      response.status(400).json({ error: 'Thứ tự việc con chưa hợp lệ.' });
      return;
    }
    const reorder = database.transaction(() => ids.forEach((id: string, position: number) => database.prepare('UPDATE subtasks SET position = ?, updated_at = ? WHERE id = ? AND task_id = ?').run(position, new Date().toISOString(), id, request.params.taskId)));
    reorder();
    response.json({ ok: true });
  });

  app.patch('/api/tasks/:taskId/subtasks/:subtaskId', authenticate, (request: AccessRequest, response) => {
    const subtask = database.prepare(`SELECT subtasks.* FROM subtasks JOIN tasks ON tasks.id = subtasks.task_id
      WHERE subtasks.id = ? AND subtasks.task_id = ? AND tasks.user_id = ?`).get(request.params.subtaskId, request.params.taskId, request.user!.id) as Record<string, unknown> | undefined;
    if (!subtask) {
      response.status(404).json({ error: 'Không tìm thấy việc con.' });
      return;
    }
    const { title, completed, position } = request.body ?? {};
    if (title !== undefined && !validText(title, 300) || completed !== undefined && typeof completed !== 'boolean' || position !== undefined && (!Number.isInteger(position) || position < 0)) {
      response.status(400).json({ error: 'Thông tin việc con chưa hợp lệ.' });
      return;
    }
    database.prepare('UPDATE subtasks SET title = ?, completed = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(title?.trim() ?? subtask.title, completed === undefined ? subtask.completed : Number(completed), position ?? subtask.position, new Date().toISOString(), request.params.subtaskId);
    response.json({ subtask: mapSubtask(database.prepare('SELECT * FROM subtasks WHERE id = ?').get(request.params.subtaskId) as Record<string, unknown>) });
  });

  app.delete('/api/tasks/:taskId/subtasks/:subtaskId', authenticate, (request: AccessRequest, response) => {
    const result = database.prepare(`DELETE FROM subtasks WHERE id = ? AND task_id = ? AND task_id IN
      (SELECT id FROM tasks WHERE user_id = ?)`)
      .run(request.params.subtaskId, request.params.taskId, request.user!.id);
    if (!result.changes) {
      response.status(404).json({ error: 'Không tìm thấy việc con.' });
      return;
    }
    response.status(204).end();
  });

  app.get('/api/analytics', authenticate, (request: AccessRequest, response) => {
    const timeZone = typeof request.query.timeZone === 'string' ? request.query.timeZone : 'Asia/Ho_Chi_Minh';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch {
      response.status(400).json({ error: 'Múi giờ chưa hợp lệ.' });
      return;
    }
    const today = localDateAt(new Date(), timeZone);
    const to = request.query.to === undefined ? today : request.query.to;
    const from = request.query.from === undefined && isDateKey(to) ? shiftDateKey(to, -29) : request.query.from;
    if (!isDateKey(from) || !isDateKey(to) || from > to || (Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86400000 > 365) {
      response.status(400).json({ error: 'Khoảng ngày cần hợp lệ và không dài quá 366 ngày.' });
      return;
    }
    const goalValue = request.query.dailyGoal === undefined ? 1 : Number(request.query.dailyGoal);
    if (!Number.isInteger(goalValue) || goalValue < 1 || goalValue > 20) {
      response.status(400).json({ error: 'Mục tiêu ngày cần từ 1 đến 20 công việc.' });
      return;
    }
    const projectId = typeof request.query.projectId === 'string' && request.query.projectId ? request.query.projectId : '';
    if (projectId && projectId !== 'unassigned' && !findOwnedProject(projectId, request.user!.id)) {
      response.status(404).json({ error: 'Không tìm thấy dự án.' });
      return;
    }
    const projectClause = projectId === 'unassigned' ? ' AND tasks.project_id IS NULL' : projectId ? ' AND tasks.project_id = ?' : '';
    const taskRows = database.prepare(`SELECT tasks.id, tasks.project_id AS projectId,
      COALESCE(projects.name, tasks.legacy_project, '') AS projectName, tasks.due_date AS dueDate,
      tasks.created_at AS createdAt, tasks.completed, tasks.completed_at AS completedAt
      FROM tasks LEFT JOIN projects ON projects.id = tasks.project_id
      WHERE tasks.user_id = ?${projectClause}`)
      .all(...(projectId && projectId !== 'unassigned' ? [request.user!.id, projectId] : [request.user!.id])) as Array<{
        id: string; projectId: string | null; projectName: string; dueDate: string; createdAt: string; completed: number; completedAt: string | null;
      }>;
    const focusRows = database.prepare(`SELECT focus_sessions.project_id AS projectId,
      COALESCE(projects.name, '') AS projectName, focus_sessions.ended_at AS endedAt,
      focus_sessions.duration_seconds AS durationSeconds FROM focus_sessions
      LEFT JOIN projects ON projects.id = focus_sessions.project_id
      WHERE focus_sessions.user_id = ? AND focus_sessions.status = 'completed'${projectId === 'unassigned' ? ' AND focus_sessions.project_id IS NULL' : projectId ? ' AND focus_sessions.project_id = ?' : ''}`)
      .all(...(projectId && projectId !== 'unassigned' ? [request.user!.id, projectId] : [request.user!.id])) as Array<{
        projectId: string | null; projectName: string; endedAt: string; durationSeconds: number;
      }>;
    response.json({ analytics: buildAnalytics(taskRows.map((task) => ({ ...task, completed: Boolean(task.completed) })), focusRows, {
      from, to, timeZone, dailyGoal: goalValue, today,
    }) });
  });

  const focusSessionById = (sessionId: string, userId: string) => database.prepare(
    'SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?',
  ).get(sessionId, userId) as Record<string, unknown> | undefined;
  const focusSessionResponse = (row: Record<string, unknown>) => ({
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    startedAt: row.started_at,
    activeStartedAt: row.active_started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    expectedDurationSeconds: row.expected_duration_seconds,
    status: row.status,
  });

  app.get('/api/focus-sessions/active', authenticate, (request: AccessRequest, response) => {
    const row = database.prepare(`SELECT * FROM focus_sessions WHERE user_id = ? AND status IN ('running', 'paused')`)
      .get(request.user!.id) as Record<string, unknown> | undefined;
    response.json({ session: row ? focusSessionResponse(row) : null });
  });

  app.post('/api/focus-sessions', authenticate, (request: AccessRequest, response) => {
    const { taskId, projectId: requestedProjectId, expectedDurationSeconds } = request.body ?? {};
    if (!Number.isInteger(expectedDurationSeconds) || expectedDurationSeconds < 60 || expectedDurationSeconds > 7200 ||
      taskId !== undefined && taskId !== null && typeof taskId !== 'string' ||
      requestedProjectId !== undefined && requestedProjectId !== null && typeof requestedProjectId !== 'string') {
      response.status(400).json({ error: 'Thời lượng hoặc liên kết phiên tập trung chưa hợp lệ.' });
      return;
    }
    const userId = request.user!.id;
    const task = typeof taskId === 'string' && taskId
      ? database.prepare('SELECT id, project_id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as { id: string; project_id: string | null } | undefined
      : undefined;
    if (typeof taskId === 'string' && taskId && !task) {
      response.status(404).json({ error: 'Không tìm thấy công việc.' });
      return;
    }
    const projectId = typeof requestedProjectId === 'string' && requestedProjectId ? requestedProjectId : task?.project_id ?? null;
    if (projectId && !findOwnedProject(projectId, userId)) {
      response.status(404).json({ error: 'Không tìm thấy dự án.' });
      return;
    }
    if (task?.project_id && projectId !== task.project_id) {
      response.status(400).json({ error: 'Dự án cần trùng với dự án của công việc.' });
      return;
    }
    if (database.prepare("SELECT 1 FROM focus_sessions WHERE user_id = ? AND status IN ('running', 'paused')").get(userId)) {
      response.status(409).json({ error: 'Bạn đã có một phiên tập trung đang mở.' });
      return;
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      database.prepare(`INSERT INTO focus_sessions (id, user_id, task_id, project_id, started_at, active_started_at,
        expected_duration_seconds, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`)
        .run(id, userId, task?.id ?? null, projectId, now, now, expectedDurationSeconds, now, now);
    } catch (error) {
      if (error instanceof Error && error.message.includes('focus_sessions_one_active_per_user')) {
        response.status(409).json({ error: 'Bạn đã có một phiên tập trung đang mở.' });
        return;
      }
      throw error;
    }
    response.status(201).json({ session: focusSessionResponse(focusSessionById(id, userId)!) });
  });

  app.post('/api/focus-sessions/:id/pause', authenticate, (request: AccessRequest, response) => {
    const sessionId = String(request.params.id);
    const row = focusSessionById(sessionId, request.user!.id);
    if (!row) {
      response.status(404).json({ error: 'Không tìm thấy phiên tập trung.' });
      return;
    }
    if (row.status !== 'running' || typeof row.active_started_at !== 'string') {
      response.status(409).json({ error: 'Phiên này không thể tạm dừng.' });
      return;
    }
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(row.active_started_at)) / 1000));
    const now = new Date().toISOString();
    database.prepare(`UPDATE focus_sessions SET status = 'paused', active_started_at = NULL,
      duration_seconds = duration_seconds + ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'running'`)
      .run(elapsed, now, sessionId, request.user!.id);
    response.json({ session: focusSessionResponse(focusSessionById(sessionId, request.user!.id)!) });
  });

  app.post('/api/focus-sessions/:id/resume', authenticate, (request: AccessRequest, response) => {
    const sessionId = String(request.params.id);
    const row = focusSessionById(sessionId, request.user!.id);
    if (!row) {
      response.status(404).json({ error: 'Không tìm thấy phiên tập trung.' });
      return;
    }
    if (row.status !== 'paused') {
      response.status(409).json({ error: 'Phiên này không thể tiếp tục.' });
      return;
    }
    const now = new Date().toISOString();
    database.prepare(`UPDATE focus_sessions SET status = 'running', active_started_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'paused'`).run(now, now, sessionId, request.user!.id);
    response.json({ session: focusSessionResponse(focusSessionById(sessionId, request.user!.id)!) });
  });

  app.post('/api/focus-sessions/:id/complete', authenticate, (request: AccessRequest, response) => {
    const sessionId = String(request.params.id);
    const row = focusSessionById(sessionId, request.user!.id);
    if (!row) {
      response.status(404).json({ error: 'Không tìm thấy phiên tập trung.' });
      return;
    }
    if (!['running', 'paused'].includes(String(row.status))) {
      response.status(409).json({ error: 'Phiên này đã kết thúc.' });
      return;
    }
    const elapsed = row.status === 'running' && typeof row.active_started_at === 'string'
      ? Math.max(0, Math.floor((Date.now() - Date.parse(row.active_started_at)) / 1000)) : 0;
    const duration = Number(row.duration_seconds) + elapsed;
    if (duration < Number(row.expected_duration_seconds) - 2 || duration > Number(row.expected_duration_seconds) + 600) {
      response.status(400).json({ error: 'Phiên chưa đạt thời lượng đã đặt hoặc đã kéo dài quá lâu.' });
      return;
    }
    const now = new Date().toISOString();
    database.prepare(`UPDATE focus_sessions SET status = 'completed', active_started_at = NULL, ended_at = ?,
      duration_seconds = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('running', 'paused')`)
      .run(now, duration, now, sessionId, request.user!.id);
    response.json({ session: focusSessionResponse(focusSessionById(sessionId, request.user!.id)!) });
  });

  app.post('/api/focus-sessions/:id/interrupt', authenticate, (request: AccessRequest, response) => {
    const sessionId = String(request.params.id);
    const row = focusSessionById(sessionId, request.user!.id);
    if (!row) {
      response.status(404).json({ error: 'Không tìm thấy phiên tập trung.' });
      return;
    }
    if (!['running', 'paused'].includes(String(row.status))) {
      response.status(409).json({ error: 'Phiên này đã kết thúc.' });
      return;
    }
    const elapsed = row.status === 'running' && typeof row.active_started_at === 'string'
      ? Math.max(0, Math.floor((Date.now() - Date.parse(row.active_started_at)) / 1000)) : 0;
    const now = new Date().toISOString();
    database.prepare(`UPDATE focus_sessions SET status = 'interrupted', active_started_at = NULL, ended_at = ?,
      duration_seconds = duration_seconds + ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('running', 'paused')`)
      .run(now, elapsed, now, sessionId, request.user!.id);
    response.json({ session: focusSessionResponse(focusSessionById(sessionId, request.user!.id)!) });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    console.error(error);
    response.status(500).json({ error: 'Đã có lỗi xảy ra. Vui lòng thử lại.' });
  });

  return app;
}