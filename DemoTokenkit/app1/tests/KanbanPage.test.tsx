import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KanbanPage from '../src/components/KanbanPage'
import type { Task, TaskStatus } from '../src/types/task'

afterEach(cleanup)

function makeTask(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: 'Plan the next release',
    category: 'Công việc',
    priority: 'medium',
    dueDate: '',
    status: 'todo',
    completed: false,
    project: '',
    tags: [],
    createdAt: '2026-04-15T09:00:00.000Z',
    ...changes,
  }
}

function renderBoard(tasks: Task[], onMove = vi.fn<(task: Task, status: TaskStatus) => void>()) {
  const props = { tasks, isLoading: false, onCreate: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onMove }
  render(<KanbanPage {...props} />)
  return { onMove }
}

describe('KanbanPage', () => {
  it('renders all three columns, distributes tasks, and shows counts', () => {
    renderBoard([
      makeTask('a'),
      makeTask('b', { status: 'in_progress' }),
      makeTask('c', { status: 'done', completed: true }),
    ])

    expect(screen.getByRole('region', { name: 'To Do, 1 công việc' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'In Progress, 1 công việc' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Done, 1 công việc' })).toBeInTheDocument()
    expect(screen.getByText('Task a')).toBeInTheDocument()
    expect(screen.getByText('Task b')).toBeInTheDocument()
    expect(screen.getByText('Task c')).toBeInTheDocument()
  })

  it('moves a task from drag and drop without duplicating it', () => {
    const task = makeTask('move-me')
    const { onMove } = renderBoard([task])
    const transfer = {
      effectAllowed: 'all',
      setData: vi.fn(),
      getData: vi.fn(() => task.id),
    }

    fireEvent.dragStart(screen.getByText(task.title).closest('article')!, { dataTransfer: transfer })
    fireEvent.drop(screen.getByRole('region', { name: 'In Progress, 0 công việc' }), { dataTransfer: transfer })

    expect(onMove).toHaveBeenCalledWith(task, 'in_progress')
    expect(screen.getAllByText(task.title)).toHaveLength(1)
  })

  it('combines project, tag, priority, and search filters and clears them', async () => {
    const user = userEvent.setup()
    renderBoard([
      makeTask('match', { title: 'Release checklist', project: 'Website', tags: ['qa'], priority: 'high' }),
      makeTask('other', { title: 'Write release notes', project: 'Mobile', tags: ['docs'], priority: 'low' }),
    ])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc dự án' }), 'Website')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc thẻ' }), 'qa')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc ưu tiên bảng' }), 'high')
    await user.type(screen.getByRole('textbox', { name: 'Tìm trên bảng' }), 'checklist')

    expect(screen.getByText('Release checklist')).toBeInTheDocument()
    expect(screen.queryByText('Write release notes')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'To Do, 1 công việc' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }))
    expect(screen.getByText('Write release notes')).toBeInTheDocument()
  })

  it('supports keyboard status changes and shows empty-column states', async () => {
    const user = userEvent.setup()
    const task = makeTask('keyboard')
    const { onMove } = renderBoard([task])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái: Task keyboard' }), 'done')
    expect(onMove).toHaveBeenCalledWith(task, 'done')
    expect(within(screen.getByRole('region', { name: 'In Progress, 0 công việc' })).getByText('Chưa có công việc.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Done, 0 công việc' })).getByText('Chưa có công việc.')).toBeInTheDocument()
  })
})