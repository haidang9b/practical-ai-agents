import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AnalyticsPage from '../src/components/AnalyticsPage'
import type { AnalyticsData, FocusSession } from '../src/lib/api'

const today = new Date().toISOString().slice(0, 10)

function analyticsData(overrides: Partial<AnalyticsData> = {}): AnalyticsData {
  return {
    range: { startDate: today, endDate: today, timezone: 'UTC' },
    totals: { created: 0, completed: 0, remaining: 0, comparison: { created: 0, completed: 0 } },
    completion: [{ date: today, count: 0 }],
    onTime: { completedOnTime: 0, completedLate: 0, overdue: 0, eligible: 0, rate: null },
    focus: { totalSeconds: 0, daily: [{ date: today, seconds: 0 }], weekly: [{ weekStart: today, seconds: 0 }], previousPeriodSeconds: 0 },
    streak: { current: 0, longest: 0, dailyGoal: 1, historyStart: today, activity: [{ date: today, count: 0 }] },
    projects: [],
    ...overrides,
  }
}

function session(status: FocusSession['status']): FocusSession {
  return {
    id: 'session-1', taskId: null, projectId: null, startedAt: new Date().toISOString(), endedAt: null,
    durationSeconds: 0, plannedDurationSeconds: 60, status, accumulatedSeconds: 0,
    activeSegmentStartedAt: status === 'running' ? new Date().toISOString() : null,
  }
}

function renderPage() {
  return render(<AnalyticsPage token="token" tasks={[]} projects={[]} onTokenRefresh={() => undefined} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Productivity analytics dashboard', () => {
  it('renders empty states, the local activity calendar, and date-range controls', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.startsWith('/api/analytics')) return Response.json(analyticsData())
      if (path === '/api/focus-sessions/active') return Response.json({ session: null })
      throw new Error(`Unexpected request ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByText('Chưa có công việc hoàn thành trong khoảng này.')).toBeInTheDocument()
    expect(screen.getByText('Chưa có phiên tập trung hoàn thành trong khoảng này.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Bản đồ hoạt động hoàn thành công việc 365 ngày qua/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Ngày bắt đầu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tháng' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('startDate='))).toBe(true))
  })

  it('shows authenticated analytics errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/analytics')
      ? Response.json({ error: 'Không thể tải thống kê.' }, { status: 500 })
      : Response.json({ session: null })))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải thống kê.')
  })

  it('switches between daily and weekly focus-time charts', async () => {
    const populated = analyticsData({
      focus: {
        totalSeconds: 1800,
        daily: [{ date: today, seconds: 1800 }],
        weekly: [{ weekStart: today, seconds: 1800 }],
        previousPeriodSeconds: 0,
      },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/analytics')
      ? Response.json(populated)
      : Response.json({ session: null })))
    renderPage()

    expect(await screen.findByRole('img', { name: 'Biểu đồ tổng thời gian tập trung theo tuần trong khoảng đã chọn' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('group', { name: 'Chế độ biểu đồ thời gian tập trung' })).getByRole('button', { name: 'Ngày' }))
    expect(screen.getByRole('img', { name: 'Biểu đồ tổng thời gian tập trung theo ngày trong khoảng đã chọn' })).toBeInTheDocument()
  })

  it('starts, pauses, and resumes a focus session using backend state', async () => {
    let active: FocusSession | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.startsWith('/api/analytics')) return Response.json(analyticsData())
      if (path === '/api/focus-sessions/active') return Response.json({ session: active })
      if (path === '/api/focus-sessions' && init?.method === 'POST') {
        active = session('running')
        return Response.json({ session: active }, { status: 201 })
      }
      if (path.endsWith('/pause')) {
        active = session('paused')
        return Response.json({ session: active })
      }
      if (path.endsWith('/resume')) {
        active = session('running')
        return Response.json({ session: active })
      }
      if (path.endsWith('/interrupt')) {
        active = null
        return Response.json({ session: session('interrupted') })
      }
      if (path.endsWith('/complete')) {
        active = null
        return Response.json({ session: session('completed') })
      }
      throw new Error(`Unexpected request ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Sẵn sàng bắt đầu')
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tập trung' }))
    await screen.findByText('Đang tập trung')
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }))
    await screen.findByText('Đang tạm dừng')
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }))
    await screen.findByText('Đang tập trung')
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/pause'))).toBe(true)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/resume'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại phiên' }))
    await screen.findByText('Sẵn sàng bắt đầu')
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/interrupt'))).toBe(true)
  })

  it('completes an elapsed focus session once and starts the configured break', async () => {
    let completed = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.startsWith('/api/analytics')) return Response.json(analyticsData())
      if (path === '/api/focus-sessions/active') return Response.json({ session: null })
      if (path === '/api/focus-sessions') {
        const started = session('running')
        started.plannedDurationSeconds = 1
        started.activeSegmentStartedAt = new Date(Date.now() - 3_000).toISOString()
        return Response.json({ session: started }, { status: 201 })
      }
      if (path.endsWith('/complete')) {
        completed = true
        return Response.json({ session: session('completed') })
      }
      throw new Error(`Unexpected request ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu tập trung' }))
    expect(await screen.findByRole('heading', { name: 'Thời gian nghỉ' })).toBeInTheDocument()
    expect(completed).toBe(true)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/complete'))).toHaveLength(1)
  })
})