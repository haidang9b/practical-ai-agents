import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import CalendarPage from '../src/components/CalendarPage'
import type { Task } from '../src/types/task'

const sampleTask: Task = {
  id: 'task-1',
  title: 'Review notes',
  description: '',
  category: 'Cá nhân',
  priority: 'high',
  dueDate: '2026-04-20',
  scheduledAt: '2026-04-15T09:30',
  status: 'todo',
  completed: false,
  project: '',
  tags: [],
  createdAt: '2026-04-10T08:00:00.000Z',
}

describe('CalendarPage', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('switches views and navigates the selected date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 15, 12))
    const { container } = render(<CalendarPage tasks={[sampleTask]} onCreate={vi.fn()} onEdit={vi.fn()} onMove={vi.fn()} onToggle={vi.fn()} />)

    expect(container.querySelector('.week-grid')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ngày' }))
    expect(container.querySelector('.day-grid')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Khoảng thời gian sau' }))
    expect(container.querySelector('.calendar-date-button strong')).toHaveTextContent('16')
    fireEvent.click(screen.getByRole('button', { name: 'Tháng' }))
    expect(container.querySelector('.month-grid')).toBeInTheDocument()
  })

  it('filters tasks and sends timed drag moves to the selected date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 15, 12))
    const onMove = vi.fn()
    const onEdit = vi.fn()
    const completedTask: Task = { ...sampleTask, id: 'task-2', title: 'File receipts', category: 'Công việc', priority: 'low', scheduledAt: '2026-04-16', completed: true }
    const { container } = render(<CalendarPage tasks={[sampleTask, completedTask]} onCreate={vi.fn()} onEdit={onEdit} onMove={onMove} onToggle={vi.fn()} />)
    const grid = container.querySelector<HTMLElement>('.week-grid')!
    expect(within(grid).getByRole('button', { name: '09:30 Review notes' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Lọc nhóm'), { target: { value: 'Công việc' } })
    expect(within(grid).queryByRole('button', { name: '09:30 Review notes' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'File receipts' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Lọc nhóm'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Lọc ưu tiên'), { target: { value: 'low' } })
    expect(within(grid).queryByRole('button', { name: '09:30 Review notes' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'File receipts' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Lọc ưu tiên'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Lọc trạng thái'), { target: { value: 'completed' } })
    expect(within(grid).queryByRole('button', { name: '09:30 Review notes' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'File receipts' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Lọc trạng thái'), { target: { value: 'active' } })
    expect(within(grid).getByRole('button', { name: '09:30 Review notes' })).toBeInTheDocument()
    expect(within(grid).queryByRole('button', { name: 'File receipts' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Lọc trạng thái'), { target: { value: 'all' } })

    fireEvent.keyDown(container.querySelector('.calendar-task')!, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith(sampleTask)

    const transfer = { effectAllowed: '', getData: vi.fn(() => 'task-1'), setData: vi.fn() }
    fireEvent.dragStart(container.querySelector('.calendar-task')!, { dataTransfer: transfer })
    fireEvent.drop(container.querySelector('[data-date="2026-04-16"]')!, { dataTransfer: transfer })
    expect(onMove).toHaveBeenCalledWith(sampleTask, '2026-04-16T09:30')
  })
})