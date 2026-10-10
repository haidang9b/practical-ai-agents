import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import type { Task } from '../src/types/task'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function testDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function mockApi() {
  const tasks: Task[] = []
  const projects: Array<Record<string, unknown>> = []
  const subtasks: Array<Record<string, unknown>> = []
  const habits: Array<Record<string, unknown>> = []
  const habitCompletions: Array<{ habitId: string; date: string }> = []
  const templates = [
    { id: 'study', name: 'Dự án học tập', description: 'Lộ trình học tập', color: '#688ca5', tasks: ['Xác định mục tiêu học tập', 'Lập lịch học', 'Hoàn thành các buổi học', 'Ôn lại tiến độ học tập'] },
    { id: 'work', name: 'Dự án công việc', description: 'Dự án công việc', color: '#55836b', tasks: ['Mục tiêu'] },
    { id: 'personal', name: 'Dự án cá nhân', description: 'Dự án cá nhân', color: '#d28c70', tasks: ['Mục tiêu'] },
  ]
  const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
  const summarizeProject = (project: Record<string, unknown>) => {
    const related = tasks.filter((task) => task.projectId === project.id)
    const completedTasks = related.filter((task) => task.completed).length
    return { ...project, totalTasks: related.length, activeTasks: related.length - completedTasks, completedTasks, overdueTasks: 0, progress: related.length ? Math.round(completedTasks / related.length * 100) : 0 }
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    requests.push({ path, method, body })

    if (path === '/api/auth/refresh') return jsonResponse({ error: 'No session' }, 401)
    if (path === '/api/auth/register' || path === '/api/auth/login') {
      const credentials = body ?? {}
      return jsonResponse({
        user: { id: 'user-1', email: credentials.email, displayName: credentials.displayName ?? 'Minh Anh' },
        accessToken: 'test-access-token',
      }, path.endsWith('register') ? 201 : 200)
    }
    const requestUrl = new URL(path, 'http://localhost')
    if (requestUrl.pathname === '/api/habits' && method === 'GET') {
      const archived = requestUrl.searchParams.get('archived')
      return jsonResponse({ habits: habits.filter((habit) => archived === 'all' || Boolean(habit.archived) === (archived === 'true')) })
    }
    if (requestUrl.pathname === '/api/habits' && method === 'POST') {
      const now = new Date().toISOString()
      const habit = { ...body, id: `habit-${habits.length + 1}`, archived: false, archivedAt: null, createdAt: now, updatedAt: now }
      habits.push(habit)
      return jsonResponse({ habit }, 201)
    }
    if (requestUrl.pathname === '/api/habit-analytics/summary') {
      const date = testDateKey()
      const activeHabits = habits.filter((habit) => !habit.archived)
      const rows = activeHabits.map((habit) => {
        const eligible = String(habit.startDate) <= date && (!habit.endDate || String(habit.endDate) >= date)
        const todayCompleted = habitCompletions.some((item) => item.habitId === habit.id && item.date === date)
        const weeklyCount = habitCompletions.filter((item) => item.habitId === habit.id).length
        return { ...habit, currentStreak: 0, longestStreak: 0, weeklyCount, weeklyTarget: habit.weeklyTarget, completedCount: weeklyCount, eligibleCount: 1, completionRate: todayCompleted ? 100 : 0, todayCompleted, eligibleToday: eligible, weekCompletions: weeklyCount, monthCompletions: weeklyCount }
      })
      const dueToday = rows.filter((habit) => habit.eligibleToday)
      const completedToday = dueToday.filter((habit) => habit.todayCompleted).length
      return jsonResponse({ date, today: { total: dueToday.length, completed: completedToday, rate: dueToday.length ? Math.round(completedToday / dueToday.length * 100) : 0 }, week: { startDate: date, completed: 0, target: activeHabits.length * 7 }, month: { completed: 0, target: activeHabits.length * 30, rate: 0 }, habits: [...rows, ...habits.filter((habit) => habit.archived)], activeCount: activeHabits.length, eligibleToday: dueToday.length, weeklyExpected: activeHabits.length * 7 })
    }
    if (requestUrl.pathname === '/api/habit-analytics/history') {
      const endDate = requestUrl.searchParams.get('endDate') ?? testDateKey()
      const startDate = requestUrl.searchParams.get('startDate') ?? endDate
      const days: Array<{ date: string; count: number; eligibleDaily: number; missedDaily: number; completions: Array<Record<string, unknown>> }> = []
      for (let cursor = new Date(`${startDate}T00:00:00`); cursor <= new Date(`${endDate}T00:00:00`); cursor.setDate(cursor.getDate() + 1)) {
        const date = testDateKey(cursor)
        const completions = habitCompletions.filter((item) => item.date === date).map((item) => {
          const habit = habits.find((candidate) => candidate.id === item.habitId)!
          return { habitId: item.habitId, name: habit.name, category: habit.category, color: habit.color }
        })
        days.push({ date, count: completions.length, eligibleDaily: 0, missedDaily: 0, completions })
      }
      return jsonResponse({ startDate, endDate, days })
    }
    const completionMatch = requestUrl.pathname.match(/^\/api\/habits\/([^/]+)\/completions\/([^/]+)$/)
    if (completionMatch && (method === 'PUT' || method === 'DELETE')) {
      const [, habitId, date] = completionMatch
      const existingIndex = habitCompletions.findIndex((item) => item.habitId === habitId && item.date === date)
      if (method === 'PUT' && existingIndex < 0) habitCompletions.push({ habitId, date })
      if (method === 'DELETE' && existingIndex >= 0) habitCompletions.splice(existingIndex, 1)
      return new Response(null, { status: 204 })
    }
    const habitMatch = requestUrl.pathname.match(/^\/api\/habits\/([^/]+)$/)
    if (habitMatch && method === 'PATCH') {
      const habit = habits.find((item) => item.id === habitMatch[1])!
      Object.assign(habit, body, { updatedAt: new Date().toISOString() })
      return jsonResponse({ habit })
    }
    if (habitMatch && method === 'DELETE') {
      habits.splice(habits.findIndex((item) => item.id === habitMatch[1]), 1)
      return new Response(null, { status: 204 })
    }
    const archiveMatch = requestUrl.pathname.match(/^\/api\/habits\/([^/]+)\/archive$/)
    if (archiveMatch && method === 'POST') {
      const habit = habits.find((item) => item.id === archiveMatch[1])!
      Object.assign(habit, { archived: true, archivedAt: new Date().toISOString() })
      return jsonResponse({ habit })
    }
    if (path === '/api/projects' && method === 'GET') return jsonResponse({ projects: projects.map(summarizeProject) })
    if (path === '/api/projects' && method === 'POST') {
      const project = { ...body, id: `project-${projects.length + 1}`, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      projects.push(project)
      return jsonResponse({ project: summarizeProject(project) }, 201)
    }
    if (path === '/api/project-templates' && method === 'GET') return jsonResponse({ templates })
    if (path === '/api/projects/from-template' && method === 'POST') {
      const template = templates.find((item) => item.id === body?.templateId)!
      const project = { ...template, ...body, id: `project-${projects.length + 1}`, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      projects.push(project)
      template.tasks.forEach((title, index) => tasks.push({ id: `template-task-${index}`, title, description: '', category: 'Học tập', priority: 'medium', dueDate: '', project: String(project.name), projectId: project.id, tags: [], status: 'todo', completed: false, createdAt: new Date().toISOString() } as Task))
      return jsonResponse({ project: summarizeProject(project) }, 201)
    }
    if (path.startsWith('/api/projects/') && method === 'PATCH') {
      const project = projects.find((item) => item.id === path.split('/').pop())!
      Object.assign(project, body)
      return jsonResponse({ project: summarizeProject(project) })
    }
    if (path.startsWith('/api/projects/') && method === 'DELETE') {
      const id = path.split('/').pop()
      const behavior = body?.taskBehavior
      for (let index = tasks.length - 1; index >= 0; index -= 1) {
        if (tasks[index].projectId === id) {
          if (behavior === 'delete') tasks.splice(index, 1)
          else tasks[index].projectId = null
        }
      }
      projects.splice(projects.findIndex((item) => item.id === id), 1)
      return new Response(null, { status: 204 })
    }
    if (path === '/api/tasks' && method === 'GET') return jsonResponse({ tasks: tasks.map((task) => ({ ...task, subtaskCount: subtasks.filter((item) => item.taskId === task.id).length, subtaskCompleted: subtasks.filter((item) => item.taskId === task.id && item.completed).length })) })
    if (path === '/api/tasks' && method === 'POST') {
      const task = { ...body, id: 'task-1', completed: false, createdAt: new Date().toISOString() } as Task
      tasks.unshift(task)
      return jsonResponse({ task }, 201)
    }
    if (path === '/api/tasks/task-1' && method === 'PATCH') {
      Object.assign(tasks[0], body)
      if (body?.status) tasks[0].completed = body.status === 'done'
      else if (body?.completed !== undefined) tasks[0].status = body.completed ? 'done' : 'todo'
      return jsonResponse({ task: tasks[0] })
    }
    if (path === '/api/tasks/task-1' && method === 'DELETE') {
      tasks.splice(0, 1)
      return new Response(null, { status: 204 })
    }
    if (path === '/api/tasks/task-1/subtasks' && method === 'GET') return jsonResponse({ subtasks: subtasks.filter((item) => item.taskId === 'task-1').sort((a, b) => Number(a.position) - Number(b.position)) })
    if (path === '/api/tasks/task-1/subtasks' && method === 'POST') {
      const subtask = { ...body, id: `subtask-${subtasks.length + 1}`, taskId: 'task-1', completed: false, position: subtasks.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      subtasks.push(subtask)
      return jsonResponse({ subtask }, 201)
    }
    if (path.startsWith('/api/tasks/task-1/subtasks/') && method === 'PATCH') {
      const subtask = subtasks.find((item) => item.id === path.split('/').pop())!
      if (typeof body?.position === 'number') {
        const neighbor = subtasks.find((item) => item.id !== subtask.id && item.position === body.position)
        if (neighbor) neighbor.position = subtask.position
      }
      Object.assign(subtask, body)
      return jsonResponse({ subtask })
    }
    if (path.startsWith('/api/tasks/task-1/subtasks/') && method === 'DELETE') {
      subtasks.splice(subtasks.findIndex((item) => item.id === path.split('/').pop()), 1)
      return new Response(null, { status: 204 })
    }
    if (path === '/api/auth/logout') return new Response(null, { status: 204 })
    return jsonResponse({ error: `Unexpected request: ${method} ${path}` }, 500)
  }))
  return { tasks, projects, subtasks, habits, habitCompletions, requests }
}

async function register(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Đăng nhập' })
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }))
  await user.type(screen.getByLabelText('Tên của bạn'), 'Minh Anh')
  await user.type(screen.getByLabelText('Email'), 'minh@example.com')
  await user.type(screen.getByLabelText('Mật khẩu'), 'password123')
  await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }))
  await screen.findByRole('heading', { name: /Chào buổi sáng, Minh Anh/ })
}

describe('Việc Nhỏ task manager authentication', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('registers, creates and completes an account-owned task', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await register(user)

    await user.click(screen.getByRole('button', { name: 'Thêm công việc' }))
    await user.type(screen.getByLabelText('Tên công việc'), 'Đọc chương một')
    await user.selectOptions(screen.getByLabelText('Nhóm'), 'Học tập')
    await user.click(screen.getByRole('button', { name: 'Tạo công việc' }))

    const task = await screen.findByText('Đọc chương một')
    const taskRow = task.closest('article')!
    await user.click(within(taskRow).getByRole('button', { name: 'Hoàn thành: Đọc chương một' }))
    expect(requests.some((request) => request.path === '/api/auth/register')).toBe(true)
    expect(requests.some((request) => request.path === '/api/tasks' && request.method === 'POST')).toBe(true)
    expect(requests.some((request) => request.path === '/api/tasks/task-1' && request.body?.completed === true)).toBe(true)
    expect(localStorage.getItem('viec-nho.tasks.v1')).toBeNull()
  })

  it('filters server-loaded tasks by their search text', async () => {
    const user = userEvent.setup()
    mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getByRole('button', { name: 'Thêm công việc' }))
    await user.type(screen.getByLabelText('Tên công việc'), 'Gọi cho mẹ')
    await user.click(screen.getByRole('button', { name: 'Tạo công việc' }))
    await user.type(screen.getByRole('textbox', { name: 'Tìm công việc' }), 'không có')
    expect(screen.getByText('Không tìm thấy công việc')).toBeInTheDocument()
    expect(screen.queryByText('Gọi cho mẹ')).not.toBeInTheDocument()
  })

  it('logs out and returns to the login screen', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getAllByRole('button', { name: 'Đăng xuất' })[0])
    await screen.findByRole('heading', { name: 'Đăng nhập' })
    expect(requests.some((request) => request.path === '/api/auth/logout' && request.method === 'POST')).toBe(true)
  })

  it('returns from the calendar to the existing task list navigation', async () => {
    const user = userEvent.setup()
    mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getByRole('button', { name: 'Lịch & kế hoạch' }))
    expect(screen.getByRole('heading', { name: 'Lịch & kế hoạch tuần' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Tổng quan/ }))
    expect(screen.getByRole('heading', { name: 'Danh sách công việc' })).toBeInTheDocument()
  })

  it("creates a habit and records today's completion from the tracker", async () => {
    const user = userEvent.setup()
    const { habits, habitCompletions, requests } = mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getByRole('button', { name: 'Thói quen' }))
    expect(screen.getByRole('heading', { name: 'Bắt đầu bằng một thói quen nhỏ' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tạo thói quen đầu tiên' }))
    await user.type(screen.getByLabelText('Tên thói quen'), 'Đọc sách mỗi ngày')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Tạo thói quen$/ }))
    const habitCard = (await screen.findByRole('heading', { name: 'Đọc sách mỗi ngày', level: 3 })).closest('article')!
    await user.click(within(habitCard).getByRole('button', { name: 'Hoàn thành Đọc sách mỗi ngày hôm nay' }))
    expect(habits).toHaveLength(1)
    expect(habitCompletions).toHaveLength(1)
    expect(habitCompletions[0].habitId).toBe(habits[0].id)
    expect(requests.some((request) => request.path === '/api/habits' && request.method === 'POST')).toBe(true)
  })

  it('persists a Kanban status change through the existing task API', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getByRole('button', { name: 'Thêm công việc' }))
    await user.type(screen.getByLabelText('Tên công việc'), 'Chuẩn bị bản phát hành')
    await user.click(screen.getByRole('button', { name: 'Tạo công việc' }))
    await user.click(screen.getByRole('button', { name: 'Bảng Kanban' }))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái: Chuẩn bị bản phát hành' }), 'in_progress')

    expect(requests.some((request) => request.path === '/api/tasks/task-1' && request.method === 'PATCH' && request.body?.status === 'in_progress')).toBe(true)
    expect(screen.getByRole('region', { name: 'In Progress, 1 công việc' })).toBeInTheDocument()
  })

  it('creates a project and assigns a task to it from the shared task editor', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getByRole('button', { name: /Dự án/ }))
    await user.click(screen.getByRole('button', { name: 'Tạo dự án' }))
    await user.type(screen.getByLabelText('Tên dự án'), 'Khu vườn nhỏ')
    await user.click(screen.getByRole('button', { name: 'Lưu dự án' }))
    await user.click(await screen.findByRole('button', { name: /Khu vườn nhỏ/ }))
    await user.click(screen.getByRole('button', { name: 'Thêm công việc' }))
    await user.type(screen.getByLabelText('Tên công việc'), 'Chuẩn bị đất')
    await user.selectOptions(screen.getByRole('combobox', { name: /Dự án/ }), 'project-1')
    await user.click(screen.getByRole('button', { name: 'Tạo công việc' }))
    await screen.findByRole('button', { name: /Chuẩn bị đất/ })
    await user.click(screen.getByRole('button', { name: /Chuẩn bị đất/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái công việc' }), 'done')
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await screen.findByText('100%')).toBeInTheDocument()
    expect(requests.some((request) => request.path === '/api/projects' && request.method === 'POST')).toBe(true)
    expect(requests.some((request) => request.path === '/api/tasks' && request.method === 'POST' && request.body?.projectId === 'project-1')).toBe(true)
  })

  it('previews and creates an editable project from a built-in template', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getByRole('button', { name: /Dự án/ }))
    await user.click(screen.getByRole('button', { name: 'Dùng mẫu' }))
    await user.click(screen.getByRole('button', { name: /Dự án học tập/ }))
    expect(screen.getByText('Xác định mục tiêu học tập')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Tên dự án'))
    await user.type(screen.getByLabelText('Tên dự án'), 'Lộ trình tiếng Việt')
    await user.click(screen.getByRole('button', { name: 'Tạo cùng công việc' }))
    expect(requests.some((request) => request.path === '/api/projects/from-template' && request.body?.templateId === 'study' && request.body?.name === 'Lộ trình tiếng Việt')).toBe(true)
  })

  it('creates and completes a subtask inside the existing task editor', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await register(user)
    await user.click(screen.getByRole('button', { name: 'Thêm công việc' }))
    await user.type(screen.getByLabelText('Tên công việc'), 'Ôn từ vựng')
    await user.click(screen.getByRole('button', { name: 'Tạo công việc' }))
    await user.click(await screen.findByRole('button', { name: 'Chỉnh sửa Ôn từ vựng' }))
    await screen.findByText('Chưa có bước nào. Thêm bước nhỏ để bắt đầu.')
    await user.type(await screen.findByRole('textbox', { name: 'Tên bước mới' }), 'Học mười từ')
    await user.click(screen.getByRole('button', { name: 'Thêm bước' }))
    await user.type(screen.getByRole('textbox', { name: 'Tên bước mới' }), 'Ôn lại từ')
    await user.click(screen.getByRole('button', { name: 'Thêm bước' }))
    await user.click(await screen.findByRole('button', { name: 'Đưa Ôn lại từ lên' }))
    await user.click(await screen.findByRole('button', { name: 'Hoàn thành bước: Học mười từ' }))
    expect(requests.some((request) => request.path === '/api/tasks/task-1/subtasks' && request.method === 'POST')).toBe(true)
    expect(requests.some((request) => request.path === '/api/tasks/task-1/subtasks/subtask-1' && request.method === 'PATCH' && request.body?.completed === true)).toBe(true)
    expect(requests.some((request) => request.path === '/api/tasks/task-1/subtasks/subtask-2' && request.method === 'PATCH' && request.body?.position === 0)).toBe(true)
    expect(screen.getByText('1/2 hoàn thành')).toBeInTheDocument()
  })
})