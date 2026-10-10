import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { db } from './database.js'
import { calculateFocusByDay, calculateOnTime, calculateStreaks, dateKeysBetween, isValidTimeZone, localDateKey, summarizeFocusByWeek } from './analytics.js'
import { calculateHabitStats, dateKeysBetween as habitDateKeysBetween, isCalendarDate as isHabitCalendarDate, shiftDate as shiftHabitDate, weekStart as habitWeekStart } from './habits.js'
import { clearRefreshCookieOptions, createTokenPair, refreshCookieOptions, revokeRefreshToken, rotateRefreshToken, verifyAccessToken } from './tokens.js'

const app = express()
const port = Number(process.env.PORT ?? 3001)
const refreshCookieName = 'viec_nho_refresh'
const categories = ['Công việc', 'Cá nhân', 'Học tập', 'Sức khỏe']
const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase())
const passwordSchema = z.string().min(8).max(72).refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'Mật khẩu tối đa 72 byte.')
const registerSchema = z.object({ displayName: z.string().trim().min(1).max(70), email: emailSchema, password: passwordSchema })
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(72) })
const taskSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(300).default(''),
  category: z.enum(categories),
  priority: z.enum(['high', 'medium', 'low']),
  dueDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).default(''),
  scheduledAt: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable().optional(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  project: z.string().trim().max(80).default(''),
  projectId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
})
const taskPatchSchema = taskSchema.partial()
  .extend({ completed: z.boolean().optional(), status: z.enum(['todo', 'in_progress', 'done']).optional(), projectId: z.string().uuid().nullable().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Thay đổi trống.')
const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).default('#55836b'),
})
const projectPatchSchema = projectSchema.partial().extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Thay đổi trống.')
const subtaskSchema = z.object({ title: z.string().trim().min(1).max(120) })
const subtaskPatchSchema = subtaskSchema.partial()
  .extend({ completed: z.boolean().optional(), position: z.number().int().min(0).optional() })
  .refine((value) => Object.keys(value).length > 0, 'Thay đổi trống.')
const analyticsQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().min(1).max(80).default('UTC'),
  projectId: z.string().uuid().optional(),
  dailyGoal: z.coerce.number().int().min(1).max(20).default(1),
})
const focusSessionSchema = z.object({
  durationSeconds: z.number().int().min(60).max(7200).default(1500),
  taskId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
})
const habitCategories = ['Sức khỏe', 'Học tập', 'Thể lực', 'Công việc', 'Cá nhân']
const habitShape = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  category: z.enum(habitCategories),
  icon: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/i).default('sparkles'),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).default('#55836b'),
  frequency: z.enum(['daily', 'weekly']),
  weeklyTarget: z.number().int().min(1).max(7),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
})
const habitSchema = habitShape.superRefine((habit, context) => {
  if (habit.frequency === 'daily' && habit.weeklyTarget !== 7) context.addIssue({ code: z.ZodIssueCode.custom, path: ['weeklyTarget'], message: 'Thói quen hằng ngày cần mục tiêu 7 ngày mỗi tuần.' })
  if (habit.endDate && habit.endDate < habit.startDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' })
  if (!isHabitCalendarDate(habit.startDate) || (habit.endDate && !isHabitCalendarDate(habit.endDate))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Ngày của thói quen không hợp lệ.' })
})
const habitPatchSchema = habitShape.partial().extend({ archived: z.boolean().optional() })
const idSchema = z.string().uuid()
const projectTemplates = [
  { id: 'study', name: 'Dự án học tập', description: 'Lộ trình học tập có mục tiêu và nhịp ôn tập rõ ràng.', color: '#688ca5', tasks: ['Xác định mục tiêu học tập', 'Lập lịch học', 'Hoàn thành các buổi học', 'Ôn lại tiến độ học tập'], category: 'Học tập' },
  { id: 'work', name: 'Dự án công việc', description: 'Từ mục tiêu đến yêu cầu, bàn giao và hoàn tất.', color: '#55836b', tasks: ['Xác định mục tiêu', 'Phân rã yêu cầu', 'Thực hiện công việc', 'Rà soát sản phẩm bàn giao', 'Hoàn tất dự án'], category: 'Công việc' },
  { id: 'personal', name: 'Dự án cá nhân', description: 'Biến mục tiêu cá nhân thành kế hoạch hành động.', color: '#d28c70', tasks: ['Xác định mục tiêu cá nhân', 'Tạo kế hoạch hành động', 'Theo dõi tiến độ', 'Đánh giá kết quả'], category: 'Cá nhân' },
]

app.disable('x-powered-by')
app.use(express.json({ limit: '20kb' }))
app.use(cookieParser())

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: 'Bạn thử quá nhiều lần. Vui lòng chờ một chút rồi thử lại.' }),
})

function publicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name ?? row.displayName }
}

function setRefreshCookie(response, token) {
  response.cookie(refreshCookieName, token, refreshCookieOptions)
}

function clearRefreshCookie(response) {
  response.clearCookie(refreshCookieName, clearRefreshCookieOptions)
}

function authenticate(request, response, next) {
  const header = request.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return response.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' })
  try {
    request.user = verifyAccessToken(token)
    next()
  } catch {
    response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' })
  }
}

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

app.post('/api/auth/register', authLimiter, async (request, response, next) => {
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Thông tin đăng ký không hợp lệ.' })

  try {
    const id = randomUUID()
    const { displayName, email, password } = parsed.data
    const passwordHash = await bcrypt.hash(password, 12)
    db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, email, displayName, passwordHash, new Date().toISOString())
    const user = { id, email, displayName }
    const tokens = createTokenPair(user)
    setRefreshCookie(response, tokens.refreshToken)
    response.status(201).json({ user, accessToken: tokens.accessToken })
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'Tài khoản email này đã tồn tại.' })
    next(error)
  }
})

app.post('/api/auth/login', authLimiter, async (request, response, next) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Vui lòng kiểm tra email và mật khẩu.' })
  try {
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.data.email)
    const matches = row ? await bcrypt.compare(parsed.data.password, row.password_hash) : false
    if (!matches) return response.status(401).json({ error: 'Email hoặc mật khẩu chưa chính xác.' })

    const user = publicUser(row)
    const tokens = createTokenPair(user)
    setRefreshCookie(response, tokens.refreshToken)
    response.json({ user, accessToken: tokens.accessToken })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/refresh', authLimiter, (request, response) => {
  const token = request.cookies[refreshCookieName]
  const result = token ? rotateRefreshToken(token) : null
  if (!result) {
    clearRefreshCookie(response)
    return response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' })
  }
  setRefreshCookie(response, result.refreshToken)
  response.json({ user: result.user, accessToken: result.accessToken })
})

app.post('/api/auth/logout', (request, response) => {
  const token = request.cookies[refreshCookieName]
  if (token) revokeRefreshToken(token)
  clearRefreshCookie(response)
  response.status(204).end()
})

app.get('/api/auth/me', authenticate, (request, response) => {
  const row = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(request.user.id)
  if (!row) return response.status(401).json({ error: 'Tài khoản không còn tồn tại.' })
  response.json({ user: publicUser(row) })
})

function serializeHabit(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    color: row.color,
    frequency: row.frequency,
    weeklyTarget: row.weekly_target,
    startDate: row.start_date,
    endDate: row.end_date,
    archived: Boolean(row.archived),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function habitRowForUser(id, userId) {
  return db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(id, userId)
}

app.get('/api/habits', authenticate, (request, response) => {
  const archived = request.query.archived ?? 'false'
  if (!['true', 'false', 'all'].includes(archived)) return response.status(400).json({ error: 'Bộ lọc thói quen không hợp lệ.' })
  const rows = archived === 'all'
    ? db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY archived, created_at DESC').all(request.user.id)
    : db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = ? ORDER BY created_at DESC').all(request.user.id, Number(archived === 'true'))
  response.json({ habits: rows.map(serializeHabit) })
})

app.get('/api/habits/:id', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã thói quen không hợp lệ.' })
  const row = habitRowForUser(request.params.id, request.user.id)
  if (!row) return response.status(404).json({ error: 'Không tìm thấy thói quen.' })
  const completions = db.prepare('SELECT completion_date AS date FROM habit_completions WHERE habit_id = ? AND user_id = ? ORDER BY completion_date DESC LIMIT 366').all(row.id, request.user.id)
  response.json({ habit: serializeHabit(row), completions: completions.map((item) => item.date) })
})

app.post('/api/habits', authenticate, (request, response) => {
  const parsed = habitSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Thói quen không hợp lệ.' })
  const now = new Date().toISOString()
  const id = randomUUID()
  const habit = parsed.data
  db.prepare(`INSERT INTO habits (id, user_id, name, description, category, icon, color, frequency, weekly_target, start_date, end_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, request.user.id, habit.name, habit.description, habit.category, habit.icon, habit.color, habit.frequency, habit.weeklyTarget, habit.startDate, habit.endDate, now, now)
  response.status(201).json({ habit: serializeHabit(habitRowForUser(id, request.user.id)) })
})

app.patch('/api/habits/:id', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã thói quen không hợp lệ.' })
  const patch = habitPatchSchema.safeParse(request.body)
  if (!patch.success || Object.keys(patch.data ?? {}).length === 0) return response.status(400).json({ error: patch.error?.issues[0]?.message ?? 'Thay đổi thói quen không hợp lệ.' })
  const current = habitRowForUser(request.params.id, request.user.id)
  if (!current) return response.status(404).json({ error: 'Không tìm thấy thói quen.' })
  const updated = habitSchema.safeParse({ ...serializeHabit(current), ...patch.data })
  if (!updated.success) return response.status(400).json({ error: updated.error.issues[0]?.message ?? 'Thói quen không hợp lệ.' })
  const archived = patch.data.archived ?? Boolean(current.archived)
  const archivedAt = archived ? (current.archived_at ?? new Date().toISOString()) : null
  const now = new Date().toISOString()
  const habit = updated.data
  db.prepare(`UPDATE habits SET name = ?, description = ?, category = ?, icon = ?, color = ?, frequency = ?, weekly_target = ?, start_date = ?, end_date = ?, archived = ?, archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(habit.name, habit.description, habit.category, habit.icon, habit.color, habit.frequency, habit.weeklyTarget, habit.startDate, habit.endDate, Number(archived), archivedAt, now, current.id, request.user.id)
  response.json({ habit: serializeHabit(habitRowForUser(current.id, request.user.id)) })
})

app.post('/api/habits/:id/archive', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã thói quen không hợp lệ.' })
  const current = habitRowForUser(request.params.id, request.user.id)
  if (!current) return response.status(404).json({ error: 'Không tìm thấy thói quen.' })
  if (!current.archived) db.prepare('UPDATE habits SET archived = 1, archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(new Date().toISOString(), new Date().toISOString(), current.id, request.user.id)
  response.json({ habit: serializeHabit(habitRowForUser(current.id, request.user.id)) })
})

app.delete('/api/habits/:id', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã thói quen không hợp lệ.' })
  const result = db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(request.params.id, request.user.id)
  if (!result.changes) return response.status(404).json({ error: 'Không tìm thấy thói quen.' })
  response.status(204).end()
})

function validHabitCompletionDate(value, timezone, response) {
  if (!isHabitCalendarDate(value)) {
    response.status(400).json({ error: 'Ngày hoàn thành không hợp lệ.' })
    return false
  }
  if (!isValidTimeZone(timezone)) {
    response.status(400).json({ error: 'Múi giờ không hợp lệ.' })
    return false
  }
  if (value > localDateKey(new Date(), timezone)) {
    response.status(400).json({ error: 'Không thể ghi nhận ngày trong tương lai.' })
    return false
  }
  return true
}

app.get('/api/habits/:id/completions', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã thói quen không hợp lệ.' })
  const habit = habitRowForUser(request.params.id, request.user.id)
  if (!habit) return response.status(404).json({ error: 'Không tìm thấy thói quen.' })
  const timezone = request.query.timezone ?? 'UTC'
  if (!isValidTimeZone(timezone)) return response.status(400).json({ error: 'Múi giờ không hợp lệ.' })
  const startDate = request.query.startDate ?? shiftHabitDate(localDateKey(new Date(), timezone), -83)
  const endDate = request.query.endDate ?? localDateKey(new Date(), timezone)
  if (!isHabitCalendarDate(startDate) || !isHabitCalendarDate(endDate) || startDate > endDate || endDate > localDateKey(new Date(), request.query.timezone ?? 'UTC') || Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`) > 365 * 86_400_000) return response.status(400).json({ error: 'Khoảng ngày không hợp lệ hoặc vượt quá 366 ngày.' })
  const dates = db.prepare('SELECT completion_date AS date FROM habit_completions WHERE habit_id = ? AND user_id = ? AND completion_date BETWEEN ? AND ? ORDER BY completion_date')
    .all(habit.id, request.user.id, startDate, endDate).map((row) => row.date)
  response.json({ completions: dates })
})

app.put('/api/habits/:id/completions/:date', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã thói quen không hợp lệ.' })
  const timezone = request.query.timezone ?? 'UTC'
  if (!validHabitCompletionDate(request.params.date, timezone, response)) return
  const habit = habitRowForUser(request.params.id, request.user.id)
  if (!habit) return response.status(404).json({ error: 'Không tìm thấy thói quen.' })
  const date = request.params.date
  if (date < habit.start_date || (habit.end_date && date > habit.end_date) || (habit.archived_at && date > habit.archived_at.slice(0, 10))) return response.status(400).json({ error: 'Ngày nằm ngoài thời gian áp dụng của thói quen.' })
  const existing = db.prepare('SELECT * FROM habit_completions WHERE habit_id = ? AND completion_date = ?').get(habit.id, date)
  if (existing) return response.json({ completion: { id: existing.id, habitId: existing.habit_id, date: existing.completion_date, updatedAt: existing.updated_at }, duplicate: true })
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare('INSERT INTO habit_completions (id, habit_id, user_id, completion_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, habit.id, request.user.id, date, now, now)
  response.json({ completion: { id, habitId: habit.id, date, updatedAt: now }, duplicate: false })
})

app.delete('/api/habits/:id/completions/:date', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã thói quen không hợp lệ.' })
  if (!validHabitCompletionDate(request.params.date, request.query.timezone ?? 'UTC', response)) return
  const habit = habitRowForUser(request.params.id, request.user.id)
  if (!habit) return response.status(404).json({ error: 'Không tìm thấy thói quen.' })
  const result = db.prepare('DELETE FROM habit_completions WHERE habit_id = ? AND user_id = ? AND completion_date = ?')
    .run(habit.id, request.user.id, request.params.date)
  if (!result.changes) return response.status(404).json({ error: 'Chưa ghi nhận ngày hoàn thành này.' })
  response.status(204).end()
})

function habitAnalyticsParameters(request, response) {
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), timezone: z.string().min(1).max(80).default('UTC') }).safeParse(request.query)
  if (!parsed.success || !isValidTimeZone(parsed.data?.timezone ?? 'UTC')) {
    response.status(400).json({ error: parsed.error?.issues[0]?.message ?? 'Bộ lọc thói quen không hợp lệ.' })
    return null
  }
  const today = localDateKey(new Date(), parsed.data.timezone)
  const date = parsed.data.date ?? today
  if (!isHabitCalendarDate(date) || date > today) {
    response.status(400).json({ error: 'Ngày thống kê không hợp lệ.' })
    return null
  }
  return { date, today, timezone: parsed.data.timezone }
}

app.get('/api/habit-analytics/summary', authenticate, (request, response) => {
  const filters = habitAnalyticsParameters(request, response)
  if (!filters) return
  const rows = db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at').all(request.user.id)
  const monday = habitWeekStart(filters.date)
  const monthStart = `${filters.date.slice(0, 7)}-01`
  const summary = rows.map((row) => {
    const habit = serializeHabit(row)
    const completions = db.prepare('SELECT completion_date FROM habit_completions WHERE habit_id = ? AND user_id = ?').all(row.id, request.user.id).map((item) => item.completion_date)
    const stats = calculateHabitStats(habit, completions, filters.date)
    const eligibleToday = filters.date >= habit.startDate && (!habit.endDate || filters.date <= habit.endDate)
    const todayCompleted = completions.includes(filters.date)
    return {
      ...habit,
      ...stats,
      todayCompleted,
      eligibleToday,
      weekCompletions: completions.filter((date) => date >= monday && date <= filters.date).length,
      monthCompletions: completions.filter((date) => date >= monthStart && date <= filters.date).length,
    }
  })
  const activeSummary = summary.filter((habit) => !habit.archived)
  const dueToday = activeSummary.filter((habit) => habit.eligibleToday)
  const completedToday = dueToday.filter((habit) => habit.todayCompleted).length
  const monthStartDate = `${filters.date.slice(0, 7)}-01`
  const monthCompletions = db.prepare('SELECT COUNT(*) AS count FROM habit_completions c JOIN habits h ON h.id = c.habit_id WHERE h.user_id = ? AND h.archived = 0 AND c.completion_date BETWEEN ? AND ?')
    .get(request.user.id, monthStartDate, filters.date).count
  const dailyEligible = rows.reduce((count, habit) => count + (!habit.archived && habit.frequency === 'daily' && filters.date >= habit.start_date && (!habit.end_date || filters.date <= habit.end_date) ? 1 : 0), 0)
  const weeklyExpected = rows.reduce((count, habit) => count + (!habit.archived && habit.frequency === 'weekly' && filters.date >= habit.start_date && (!habit.end_date || filters.date <= habit.end_date) ? habit.weekly_target : 0), 0)
  const monthExpected = activeSummary.reduce((total, habit) => {
    if (habit.frequency === 'daily') {
      const first = habit.startDate > monthStartDate ? habit.startDate : monthStartDate
      const last = habit.endDate && habit.endDate < filters.date ? habit.endDate : filters.date
      return total + (first <= last ? Math.floor((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1 : 0)
    }
    const last = habit.endDate && habit.endDate < filters.date ? habit.endDate : filters.date
    let eligibleWeeks = 0
    for (let week = habitWeekStart(monthStartDate); week <= last; week = shiftHabitDate(week, 7)) {
      const weekEnd = shiftHabitDate(week, 6)
      if (weekEnd >= habit.startDate && week <= last) eligibleWeeks += 1
    }
    return total + eligibleWeeks * habit.weeklyTarget
  }, 0)
  response.json({
    date: filters.date,
    today: { total: dueToday.length, completed: completedToday, rate: dueToday.length ? Math.round(completedToday / dueToday.length * 100) : 0 },
    week: { startDate: monday, completed: activeSummary.reduce((count, habit) => count + habit.weekCompletions, 0), target: activeSummary.filter((habit) => !habit.archived).reduce((count, habit) => count + (habit.frequency === 'weekly' ? habit.weeklyTarget : 7), 0) },
    month: { completed: monthCompletions, target: monthExpected, rate: monthExpected ? Math.min(100, Math.round(monthCompletions / monthExpected * 100)) : 0 },
    habits: summary,
    activeCount: activeSummary.length,
    eligibleToday: dailyEligible + summary.filter((habit) => habit.frequency === 'weekly' && habit.eligibleToday).length,
    weeklyExpected,
  })
})

app.get('/api/habit-analytics/history', authenticate, (request, response) => {
  const timezone = request.query.timezone ?? 'UTC'
  if (!isValidTimeZone(timezone)) return response.status(400).json({ error: 'Múi giờ không hợp lệ.' })
  const today = localDateKey(new Date(), timezone)
  const endDate = request.query.endDate ?? today
  const startDate = request.query.startDate ?? shiftHabitDate(endDate, -83)
  if (!isHabitCalendarDate(startDate) || !isHabitCalendarDate(endDate) || startDate > endDate || endDate > today || Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`) > 365 * 86_400_000) return response.status(400).json({ error: 'Khoảng ngày không hợp lệ hoặc vượt quá 366 ngày.' })
  const rows = db.prepare(`SELECT c.habit_id AS habitId, c.completion_date AS date, h.name, h.category, h.color
    FROM habit_completions c JOIN habits h ON h.id = c.habit_id
    WHERE c.user_id = ? AND c.completion_date BETWEEN ? AND ? ORDER BY c.completion_date, h.name`).all(request.user.id, startDate, endDate)
  const historyHabits = db.prepare('SELECT id, frequency, start_date, end_date, archived_at FROM habits WHERE user_id = ?').all(request.user.id)
  const completionsByDate = new Map()
  for (const row of rows) {
    if (!completionsByDate.has(row.date)) completionsByDate.set(row.date, [])
    completionsByDate.get(row.date).push(row)
  }
  response.json({
    startDate,
    endDate,
    days: habitDateKeysBetween(startDate, endDate).map((date) => {
      const completions = completionsByDate.get(date) ?? []
      const completedIds = new Set(completions.map((row) => row.habitId))
      const eligibleDaily = historyHabits.filter((habit) => habit.frequency === 'daily' && date >= habit.start_date && (!habit.end_date || date <= habit.end_date) && (!habit.archived_at || date <= habit.archived_at.slice(0, 10)))
      return {
        date,
        count: completions.length,
        eligibleDaily: eligibleDaily.length,
        missedDaily: eligibleDaily.filter((habit) => !completedIds.has(habit.id)).length,
        completions: completions.map(({ habitId, name, category, color }) => ({ habitId, name, category, color })),
      }
    }),
  })
})

function serializeTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    dueDate: row.due_date,
    scheduledAt: row.scheduled_at || null,
    status: row.status ?? (row.completed ? 'done' : 'todo'),
    completed: Boolean(row.completed),
    completedAt: row.completed_at ?? null,
    project: row.project ?? '',
    projectId: row.project_id ?? null,
    subtaskCount: row.subtask_count ?? 0,
    subtaskCompleted: row.subtask_completed ?? 0,
    tags: JSON.parse(row.tags || '[]'),
    createdAt: row.created_at,
  }
}

function serializeSubtask(row) {
  return { id: row.id, taskId: row.task_id, title: row.title, completed: Boolean(row.completed), position: row.position, createdAt: row.created_at, updatedAt: row.updated_at }
}

function serializeProject(row, userId) {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const stats = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN completed = 0 AND due_date <> '' AND due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM tasks WHERE user_id = ? AND project_id = ?
  `).get(today, userId, row.id)
  const completedCount = stats.completed ?? 0
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalTasks: stats.total,
    activeTasks: stats.active ?? 0,
    completedTasks: completedCount,
    overdueTasks: stats.overdue ?? 0,
    progress: stats.total ? Math.round(completedCount / stats.total * 100) : 0,
  }
}

function serializeProjectTask(row) {
  return serializeTask(row)
}

function projectRow(id, userId) {
  return db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId)
}

app.get('/api/project-templates', authenticate, (_request, response) => {
  response.json({ templates: projectTemplates.map(({ id, name, description, color, tasks }) => ({ id, name, description, color, tasks })) })
})

app.get('/api/projects', authenticate, (request, response) => {
  const rows = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY archived, created_at DESC').all(request.user.id)
  response.json({ projects: rows.map((row) => serializeProject(row, request.user.id)) })
})

app.get('/api/projects/:id', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã dự án không hợp lệ.' })
  const row = projectRow(request.params.id, request.user.id)
  if (!row) return response.status(404).json({ error: 'Không tìm thấy dự án.' })
  const tasks = db.prepare(`SELECT t.*,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.completed = 1) AS subtask_completed
    FROM tasks t WHERE t.user_id = ? AND t.project_id = ? ORDER BY t.created_at DESC`).all(request.user.id, row.id)
  response.json({ project: serializeProject(row, request.user.id), tasks: tasks.map(serializeProjectTask) })
})

app.post('/api/projects', authenticate, (request, response) => {
  const parsed = projectSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dự án không hợp lệ.' })
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare('INSERT INTO projects (id, user_id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, request.user.id, parsed.data.name, parsed.data.description, parsed.data.color, now, now)
  response.status(201).json({ project: serializeProject(projectRow(id, request.user.id), request.user.id) })
})

app.patch('/api/projects/:id', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã dự án không hợp lệ.' })
  const parsed = projectPatchSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dự án không hợp lệ.' })
  const current = projectRow(request.params.id, request.user.id)
  if (!current) return response.status(404).json({ error: 'Không tìm thấy dự án.' })
  const updated = { ...current, ...parsed.data }
  db.prepare('UPDATE projects SET name = ?, description = ?, color = ?, archived = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(updated.name, updated.description, updated.color, Number(updated.archived), new Date().toISOString(), current.id, request.user.id)
  response.json({ project: serializeProject(projectRow(current.id, request.user.id), request.user.id) })
})

app.delete('/api/projects/:id', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã dự án không hợp lệ.' })
  const choice = z.object({ taskBehavior: z.enum(['unassign', 'delete']) }).safeParse(request.body)
  if (!choice.success) return response.status(400).json({ error: 'Hãy chọn chuyển công việc sang chưa gán hoặc xóa chúng.' })
  const removeProject = db.transaction(() => {
    const project = projectRow(request.params.id, request.user.id)
    if (!project) return false
    if (choice.data.taskBehavior === 'delete') {
      db.prepare('DELETE FROM tasks WHERE user_id = ? AND project_id = ?').run(request.user.id, project.id)
    } else {
      db.prepare('UPDATE tasks SET project_id = NULL WHERE user_id = ? AND project_id = ?').run(request.user.id, project.id)
    }
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(project.id, request.user.id)
    return true
  })
  if (!removeProject()) return response.status(404).json({ error: 'Không tìm thấy dự án.' })
  response.status(204).end()
})

app.post('/api/projects/from-template', authenticate, (request, response) => {
  const parsed = z.object({ templateId: z.enum(['study', 'work', 'personal']), name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(500).optional(), color: z.string().regex(/^#[\da-fA-F]{6}$/).optional() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Mẫu dự án không hợp lệ.' })
  const template = projectTemplates.find((item) => item.id === parsed.data.templateId)
  const now = new Date().toISOString()
  const projectId = randomUUID()
  const createFromTemplate = db.transaction(() => {
    db.prepare('INSERT INTO projects (id, user_id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, request.user.id, parsed.data.name ?? template.name, parsed.data.description ?? template.description, parsed.data.color ?? template.color, now, now)
    const insertTask = db.prepare(`INSERT INTO tasks (id, user_id, title, description, category, priority, due_date, scheduled_at, status, project, project_id, tags, completed, created_at)
      VALUES (?, ?, ?, '', ?, 'medium', '', '', 'todo', '', ?, '[]', 0, ?)`)
    template.tasks.forEach((title) => insertTask.run(randomUUID(), request.user.id, title, template.category, projectId, now))
  })
  createFromTemplate()
  response.status(201).json({ project: serializeProject(projectRow(projectId, request.user.id), request.user.id) })
})

app.get('/api/tasks/:taskId/subtasks', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.taskId).success) return response.status(400).json({ error: 'Mã công việc không hợp lệ.' })
  const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(request.params.taskId, request.user.id)
  if (!task) return response.status(404).json({ error: 'Không tìm thấy công việc.' })
  const rows = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, created_at').all(task.id)
  response.json({ subtasks: rows.map(serializeSubtask) })
})

app.post('/api/tasks/:taskId/subtasks', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.taskId).success) return response.status(400).json({ error: 'Mã công việc không hợp lệ.' })
  const parsed = subtaskSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Tiêu đề bước con không hợp lệ.' })
  const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(request.params.taskId, request.user.id)
  if (!task) return response.status(404).json({ error: 'Không tìm thấy công việc.' })
  const now = new Date().toISOString()
  const id = randomUUID()
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM subtasks WHERE task_id = ?').get(task.id).next
  db.prepare('INSERT INTO subtasks (id, task_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, task.id, parsed.data.title, position, now, now)
  response.status(201).json({ subtask: serializeSubtask(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id)) })
})

app.patch('/api/tasks/:taskId/subtasks/:subtaskId', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.taskId).success || !idSchema.safeParse(request.params.subtaskId).success) return response.status(400).json({ error: 'Mã bước con không hợp lệ.' })
  const parsed = subtaskPatchSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Bước con không hợp lệ.' })
  const row = db.prepare('SELECT s.* FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ? AND s.task_id = ? AND t.user_id = ?')
    .get(request.params.subtaskId, request.params.taskId, request.user.id)
  if (!row) return response.status(404).json({ error: 'Không tìm thấy bước con.' })
  const updated = { ...row, ...parsed.data }
  const saveSubtask = db.transaction(() => {
    const now = new Date().toISOString()
    if (parsed.data.position !== undefined && parsed.data.position !== row.position) {
      const neighbor = db.prepare('SELECT id FROM subtasks WHERE task_id = ? AND position = ? AND id <> ?').get(row.task_id, parsed.data.position, row.id)
      if (neighbor) db.prepare('UPDATE subtasks SET position = ?, updated_at = ? WHERE id = ?').run(row.position, now, neighbor.id)
    }
    db.prepare('UPDATE subtasks SET title = ?, completed = ?, position = ?, updated_at = ? WHERE id = ? AND task_id = ?')
      .run(updated.title, Number(updated.completed), updated.position, now, row.id, row.task_id)
  })
  saveSubtask()
  response.json({ subtask: serializeSubtask(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(row.id)) })
})

app.delete('/api/tasks/:taskId/subtasks/:subtaskId', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.taskId).success || !idSchema.safeParse(request.params.subtaskId).success) return response.status(400).json({ error: 'Mã bước con không hợp lệ.' })
  const result = db.prepare(`DELETE FROM subtasks WHERE id = ? AND task_id = ? AND task_id IN (SELECT id FROM tasks WHERE user_id = ?)`)
    .run(request.params.subtaskId, request.params.taskId, request.user.id)
  if (!result.changes) return response.status(404).json({ error: 'Không tìm thấy bước con.' })
  response.status(204).end()
})

app.get('/api/tasks', authenticate, (request, response) => {
  const projectId = request.query.projectId
  if (projectId !== undefined && projectId !== 'unassigned' && !idSchema.safeParse(projectId).success) return response.status(400).json({ error: 'Mã dự án không hợp lệ.' })
  const taskSelect = `SELECT t.*,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.completed = 1) AS subtask_completed
    FROM tasks t`
  const rows = projectId === undefined
    ? db.prepare(`${taskSelect} WHERE t.user_id = ? ORDER BY t.created_at DESC`).all(request.user.id)
    : projectId === 'unassigned'
      ? db.prepare(`${taskSelect} WHERE t.user_id = ? AND t.project_id IS NULL ORDER BY t.created_at DESC`).all(request.user.id)
      : db.prepare(`${taskSelect} WHERE t.user_id = ? AND t.project_id = ? ORDER BY t.created_at DESC`).all(request.user.id, projectId)
  response.json({ tasks: rows.map(serializeTask) })
})

app.post('/api/tasks', authenticate, (request, response) => {
  const parsed = taskSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Công việc không hợp lệ.' })
  const status = parsed.data.status ?? 'todo'
  if (parsed.data.projectId && !projectRow(parsed.data.projectId, request.user.id)) return response.status(404).json({ error: 'Không tìm thấy dự án được chọn.' })
  const now = new Date().toISOString()
  const task = { ...parsed.data, status, id: randomUUID(), completed: status === 'done', completedAt: status === 'done' ? now : null, completedDueDate: status === 'done' ? parsed.data.dueDate : '', createdAt: now }
  db.prepare('INSERT INTO tasks (id, user_id, title, description, category, priority, due_date, scheduled_at, status, project, project_id, tags, completed, created_at, completed_at, completed_due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(task.id, request.user.id, task.title, task.description, task.category, task.priority, task.dueDate, task.scheduledAt ?? '', task.status, task.project, task.projectId ?? null, JSON.stringify(task.tags), Number(task.completed), task.createdAt, task.completedAt, task.completedDueDate)
  response.status(201).json({ task })
})

app.patch('/api/tasks/:id', authenticate, (request, response) => {
  const parsed = taskPatchSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Công việc không hợp lệ.' })
  const row = db.prepare(`SELECT t.*,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.completed = 1) AS subtask_completed
    FROM tasks t WHERE t.id = ? AND t.user_id = ?`).get(request.params.id, request.user.id)
  if (!row) return response.status(404).json({ error: 'Không tìm thấy công việc.' })
  if (parsed.data.projectId && !projectRow(parsed.data.projectId, request.user.id)) return response.status(404).json({ error: 'Không tìm thấy dự án được chọn.' })
  const task = { ...serializeTask(row), ...parsed.data }
  if (parsed.data.status) task.completed = parsed.data.status === 'done'
  else if (parsed.data.completed !== undefined) task.status = parsed.data.completed ? 'done' : 'todo'
  const wasCompleted = Boolean(row.completed)
  task.completedAt = !wasCompleted && task.completed ? new Date().toISOString() : wasCompleted && !task.completed ? null : row.completed_at ?? null
  task.completedDueDate = !wasCompleted && task.completed ? task.dueDate : wasCompleted && !task.completed ? '' : row.completed_due_date ?? ''
  db.prepare('UPDATE tasks SET title = ?, description = ?, category = ?, priority = ?, due_date = ?, scheduled_at = ?, status = ?, project = ?, project_id = ?, tags = ?, completed = ?, completed_at = ?, completed_due_date = ? WHERE id = ? AND user_id = ?')
    .run(task.title, task.description, task.category, task.priority, task.dueDate, task.scheduledAt ?? '', task.status, task.project, task.projectId ?? null, JSON.stringify(task.tags), Number(task.completed), task.completedAt, task.completedDueDate, task.id, request.user.id)
  response.json({ task })
})

app.delete('/api/tasks/:id', authenticate, (request, response) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(request.params.id, request.user.id)
  if (!result.changes) return response.status(404).json({ error: 'Không tìm thấy công việc.' })
  response.status(204).end()
})

function analyticsParameters(request, response) {
  const parsed = analyticsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Bộ lọc thống kê không hợp lệ.' })
    return null
  }
  const { timezone, startDate, endDate, projectId, dailyGoal } = parsed.data
  if (!isValidTimeZone(timezone)) {
    response.status(400).json({ error: 'Múi giờ không hợp lệ.' })
    return null
  }
  const today = localDateKey(new Date(), timezone)
  const end = endDate ?? today
  const start = startDate ?? shiftDate(end, -29)
  const span = new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()
  if (!isCalendarDate(start) || !isCalendarDate(end) || start > end || span > 365 * 86_400_000) {
    response.status(400).json({ error: 'Khoảng ngày phải hợp lệ và không dài quá 366 ngày.' })
    return null
  }
  if (projectId && !projectRow(projectId, request.user.id)) {
    response.status(404).json({ error: 'Không tìm thấy dự án được chọn.' })
    return null
  }
  return { timezone, start, end, today, projectId, dailyGoal }
}

function isCalendarDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function shiftDate(value, amount) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function filterClause(projectId) {
  return projectId ? ' AND project_id = ?' : ''
}

function focusSessionView(row, durationSeconds = row.duration_seconds) {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds,
    plannedDurationSeconds: row.planned_duration_seconds,
    status: row.status,
  }
}

app.get('/api/analytics', authenticate, (request, response) => {
  const filters = analyticsParameters(request, response)
  if (!filters) return
  const { timezone, start, end, today, projectId, dailyGoal } = filters
  const rangeDays = dateKeysBetween(start, end)
  const previousStart = shiftDate(start, -rangeDays.length)
  const previousEnd = shiftDate(start, -1)
  const clause = filterClause(projectId)
  const params = projectId ? [request.user.id, projectId] : [request.user.id]
  const tasks = db.prepare(`SELECT id, project_id, created_at, completed_at, completed, due_date, completed_due_date FROM tasks WHERE user_id = ?${clause}`).all(...params)
  const currentCreated = tasks.filter((task) => {
    const date = localDateKey(task.created_at, timezone)
    return date >= start && date <= end
  })
  const currentCompleted = tasks.filter((task) => task.completed_at && localDateKey(task.completed_at, timezone) >= start && localDateKey(task.completed_at, timezone) <= end)
  const previousCreated = tasks.filter((task) => {
    const date = localDateKey(task.created_at, timezone)
    return date >= previousStart && date <= previousEnd
  })
  const previousCompleted = tasks.filter((task) => task.completed_at && localDateKey(task.completed_at, timezone) >= previousStart && localDateKey(task.completed_at, timezone) <= previousEnd)
  const countsByDate = Object.fromEntries(rangeDays.map((date) => [date, 0]))
  for (const task of currentCompleted) countsByDate[localDateKey(task.completed_at, timezone)] += 1

  const completedByDate = {}
  for (const task of tasks) {
    if (!task.completed_at) continue
    const date = localDateKey(task.completed_at, timezone)
    if (date <= today) completedByDate[date] = (completedByDate[date] ?? 0) + 1
  }
  const streak = calculateStreaks(completedByDate, today, dailyGoal)
  const historyStart = shiftDate(today, -364)
  const activity = dateKeysBetween(historyStart, today).map((date) => ({ date, count: completedByDate[date] ?? 0 }))
  const onTime = calculateOnTime(tasks, timezone, start, end, today)
  const projectRows = db.prepare('SELECT id, name, color FROM projects WHERE user_id = ? ORDER BY name').all(request.user.id)
  const projectBreakdown = projectRows.map((project) => {
    const assigned = tasks.filter((task) => task.project_id === project.id)
    return {
      id: project.id,
      name: project.name,
      color: project.color,
      created: assigned.filter((task) => currentCreated.includes(task)).length,
      completed: assigned.filter((task) => currentCompleted.includes(task)).length,
      remaining: assigned.filter((task) => !task.completed).length,
    }
  }).filter((project) => project.created || project.completed || project.remaining)

  const segments = db.prepare(`SELECT segment.started_at, segment.ended_at
    FROM focus_session_segments segment JOIN focus_sessions session ON session.id = segment.session_id
    WHERE session.user_id = ? AND session.status = 'completed' AND segment.ended_at IS NOT NULL${projectId ? ' AND session.project_id = ?' : ''}`).all(...params)
  const dailyFocus = calculateFocusByDay(segments, rangeDays, timezone)
  const weeklyFocus = summarizeFocusByWeek(dailyFocus)
  const previousFocus = calculateFocusByDay(segments, dateKeysBetween(previousStart, previousEnd), timezone)
  response.json({
    range: { startDate: start, endDate: end, timezone },
    totals: {
      created: currentCreated.length,
      completed: currentCompleted.length,
      remaining: tasks.filter((task) => !task.completed).length,
      comparison: { created: previousCreated.length, completed: previousCompleted.length },
    },
    completion: rangeDays.map((date) => ({ date, count: countsByDate[date] })),
    onTime,
    focus: {
      totalSeconds: dailyFocus.reduce((sum, entry) => sum + entry.seconds, 0),
      daily: dailyFocus,
      weekly: weeklyFocus,
      previousPeriodSeconds: previousFocus.reduce((sum, entry) => sum + entry.seconds, 0),
    },
    streak: { ...streak, dailyGoal, historyStart, activity },
    projects: projectBreakdown,
  })
})

app.get('/api/focus-sessions/active', authenticate, (request, response) => {
  const row = db.prepare("SELECT * FROM focus_sessions WHERE user_id = ? AND status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1").get(request.user.id)
  if (!row) return response.json({ session: null })
  const closedSeconds = db.prepare('SELECT COALESCE(SUM(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)), 0) AS seconds FROM focus_session_segments WHERE session_id = ? AND ended_at IS NOT NULL').get(row.id).seconds
  const activeSegment = db.prepare('SELECT started_at FROM focus_session_segments WHERE session_id = ? AND ended_at IS NULL').get(row.id)
  const currentSeconds = row.status === 'running' && activeSegment
    ? Math.max(0, Math.floor((Date.now() - new Date(activeSegment.started_at).getTime()) / 1000))
    : 0
  response.json({ session: { ...focusSessionView(row, closedSeconds + currentSeconds), accumulatedSeconds: closedSeconds, activeSegmentStartedAt: activeSegment?.started_at ?? null } })
})

app.post('/api/focus-sessions', authenticate, (request, response) => {
  const parsed = focusSessionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Phiên tập trung không hợp lệ.' })
  if (db.prepare("SELECT id FROM focus_sessions WHERE user_id = ? AND status IN ('running', 'paused')").get(request.user.id)) return response.status(409).json({ error: 'Bạn đang có một phiên tập trung chưa kết thúc.' })
  let projectId = parsed.data.projectId ?? null
  if (parsed.data.taskId) {
    const task = db.prepare('SELECT project_id FROM tasks WHERE id = ? AND user_id = ?').get(parsed.data.taskId, request.user.id)
    if (!task) return response.status(404).json({ error: 'Không tìm thấy công việc được chọn.' })
    if (projectId && task.project_id !== projectId) return response.status(400).json({ error: 'Dự án không khớp với công việc.' })
    projectId ??= task.project_id
  }
  if (projectId && !projectRow(projectId, request.user.id)) return response.status(404).json({ error: 'Không tìm thấy dự án được chọn.' })
  const id = randomUUID()
  const now = new Date().toISOString()
  const insert = db.transaction(() => {
    db.prepare(`INSERT INTO focus_sessions (id, user_id, task_id, project_id, started_at, duration_seconds, planned_duration_seconds, status, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, 'running', ?)`).run(id, request.user.id, parsed.data.taskId ?? null, projectId, now, parsed.data.durationSeconds, now)
    db.prepare('INSERT INTO focus_session_segments (id, session_id, started_at) VALUES (?, ?, ?)').run(randomUUID(), id, now)
  })
  insert()
  response.status(201).json({ session: { ...focusSessionView(db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(id)), accumulatedSeconds: 0, activeSegmentStartedAt: now } })
})

function focusSessionForUser(sessionId, userId) {
  return db.prepare('SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId)
}

function focusSessionClosedSeconds(sessionId) {
  const segments = db.prepare('SELECT started_at, ended_at FROM focus_session_segments WHERE session_id = ? AND ended_at IS NOT NULL').all(sessionId)
  const milliseconds = segments.reduce((total, segment) => total + Math.max(0, new Date(segment.ended_at).getTime() - new Date(segment.started_at).getTime()), 0)
  return Math.floor(milliseconds / 1000)
}

app.post('/api/focus-sessions/:id/pause', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã phiên tập trung không hợp lệ.' })
  const session = focusSessionForUser(request.params.id, request.user.id)
  if (!session) return response.status(404).json({ error: 'Không tìm thấy phiên tập trung.' })
  if (session.status !== 'running') return response.status(409).json({ error: 'Phiên tập trung không ở trạng thái đang chạy.' })
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare('UPDATE focus_session_segments SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL').run(now, session.id)
    db.prepare("UPDATE focus_sessions SET status = 'paused' WHERE id = ? AND user_id = ? AND status = 'running'").run(session.id, request.user.id)
  })()
  response.json({ session: { ...focusSessionView(focusSessionForUser(session.id, request.user.id)), accumulatedSeconds: focusSessionClosedSeconds(session.id) } })
})

app.post('/api/focus-sessions/:id/resume', authenticate, (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã phiên tập trung không hợp lệ.' })
  const session = focusSessionForUser(request.params.id, request.user.id)
  if (!session) return response.status(404).json({ error: 'Không tìm thấy phiên tập trung.' })
  if (session.status !== 'paused') return response.status(409).json({ error: 'Chỉ có thể tiếp tục phiên đang tạm dừng.' })
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare("UPDATE focus_sessions SET status = 'running' WHERE id = ? AND user_id = ? AND status = 'paused'").run(session.id, request.user.id)
    db.prepare('INSERT INTO focus_session_segments (id, session_id, started_at) VALUES (?, ?, ?)').run(randomUUID(), session.id, now)
  })()
  response.json({ session: { ...focusSessionView(focusSessionForUser(session.id, request.user.id)), accumulatedSeconds: focusSessionClosedSeconds(session.id), activeSegmentStartedAt: now } })
})

function closeFocusSession(request, response, status) {
  if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Mã phiên tập trung không hợp lệ.' })
  const session = focusSessionForUser(request.params.id, request.user.id)
  if (!session) return response.status(404).json({ error: 'Không tìm thấy phiên tập trung.' })
  if (session.status === status) return response.json({ session: focusSessionView(session), duplicate: true })
  if (!['running', 'paused'].includes(session.status)) return response.status(409).json({ error: 'Phiên tập trung đã kết thúc.' })
  const now = new Date().toISOString()
  const openSegment = db.prepare('SELECT started_at FROM focus_session_segments WHERE session_id = ? AND ended_at IS NULL').get(session.id)
  const closed = db.prepare('SELECT COALESCE(SUM(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)), 0) AS seconds FROM focus_session_segments WHERE session_id = ? AND ended_at IS NOT NULL').get(session.id).seconds
  const duration = closed + (openSegment ? Math.max(0, Math.floor((Date.now() - new Date(openSegment.started_at).getTime()) / 1000)) : 0)
  if (status === 'completed' && duration < session.planned_duration_seconds) return response.status(409).json({ error: 'Chỉ có thể hoàn thành phiên sau khi đã đủ thời lượng tập trung.' })
  db.transaction(() => {
    if (openSegment) db.prepare('UPDATE focus_session_segments SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL').run(now, session.id)
    db.prepare('UPDATE focus_sessions SET ended_at = ?, duration_seconds = ?, status = ? WHERE id = ? AND user_id = ?').run(now, duration, status, session.id, request.user.id)
  })()
  response.json({ session: focusSessionView(focusSessionForUser(session.id, request.user.id)) })
}

app.post('/api/focus-sessions/:id/complete', authenticate, (request, response) => closeFocusSession(request, response, 'completed'))
app.post('/api/focus-sessions/:id/interrupt', authenticate, (request, response) => closeFocusSession(request, response, 'interrupted'))

if (process.env.NODE_ENV === 'production') {
  const buildDirectory = resolve('dist')
  app.use(express.static(buildDirectory, { index: false }))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/') || !request.accepts('html')) return next()
    response.sendFile(resolve(buildDirectory, 'index.html'))
  })
}

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ error: 'Đã có lỗi xảy ra. Vui lòng thử lại.' })
})

app.listen(port, () => console.log(`Việc Nhỏ API listening on http://localhost:${port}`))