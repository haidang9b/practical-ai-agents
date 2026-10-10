import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import type { Task } from '../src/types/task'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockApi() {
  const tasks: Task[] = []
  const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
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
    if (path === '/api/tasks' && method === 'GET') return jsonResponse({ tasks })
    if (path === '/api/tasks' && method === 'POST') {
      const task = { ...body, id: 'task-1', completed: false, createdAt: new Date().toISOString() } as Task
      tasks.unshift(task)
      return jsonResponse({ task }, 201)
    }
    if (path === '/api/tasks/task-1' && method === 'PATCH') {
      Object.assign(tasks[0], body)
      return jsonResponse({ task: tasks[0] })
    }
    if (path === '/api/tasks/task-1' && method === 'DELETE') {
      tasks.splice(0, 1)
      return new Response(null, { status: 204 })
    }
    if (path === '/api/auth/logout') return new Response(null, { status: 204 })
    return jsonResponse({ error: `Unexpected request: ${method} ${path}` }, 500)
  }))
  return { tasks, requests }
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
})