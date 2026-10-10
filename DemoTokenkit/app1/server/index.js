import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { db } from './database.js'
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
})
const taskPatchSchema = taskSchema.partial()
  .extend({ completed: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Thay đổi trống.')

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

function serializeTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    dueDate: row.due_date,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
  }
}

app.get('/api/tasks', authenticate, (request, response) => {
  const rows = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC').all(request.user.id)
  response.json({ tasks: rows.map(serializeTask) })
})

app.post('/api/tasks', authenticate, (request, response) => {
  const parsed = taskSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Công việc không hợp lệ.' })
  const task = { ...parsed.data, id: randomUUID(), completed: false, createdAt: new Date().toISOString() }
  db.prepare('INSERT INTO tasks (id, user_id, title, description, category, priority, due_date, completed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(task.id, request.user.id, task.title, task.description, task.category, task.priority, task.dueDate, 0, task.createdAt)
  response.status(201).json({ task })
})

app.patch('/api/tasks/:id', authenticate, (request, response) => {
  const parsed = taskPatchSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Công việc không hợp lệ.' })
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(request.params.id, request.user.id)
  if (!row) return response.status(404).json({ error: 'Không tìm thấy công việc.' })
  const task = { ...serializeTask(row), ...parsed.data }
  db.prepare('UPDATE tasks SET title = ?, description = ?, category = ?, priority = ?, due_date = ?, completed = ? WHERE id = ? AND user_id = ?')
    .run(task.title, task.description, task.category, task.priority, task.dueDate, Number(task.completed), task.id, request.user.id)
  response.json({ task })
})

app.delete('/api/tasks/:id', authenticate, (request, response) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(request.params.id, request.user.id)
  if (!result.changes) return response.status(404).json({ error: 'Không tìm thấy công việc.' })
  response.status(204).end()
})

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