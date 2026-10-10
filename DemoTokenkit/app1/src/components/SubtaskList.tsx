import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react'
import { createSubtask, deleteSubtask, getSubtasks, updateSubtask } from '../lib/api'
import type { Subtask } from '../types/project'

interface SubtaskListProps {
  token: string
  taskId: string
  onTokenRefresh: (token: string) => void
  onSubtasksChanged: () => void
}

export default function SubtaskList({ token, taskId, onTokenRefresh, onSubtasksChanged }: SubtaskListProps) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExpanded, setIsExpanded] = useState(true)

  const load = useCallback(() => getSubtasks(token, taskId, onTokenRefresh)
    .then(({ subtasks: loaded }) => { setSubtasks(loaded); setError('') })
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Không thể tải checklist.'))
    .finally(() => setIsLoading(false)), [token, taskId, onTokenRefresh])
  useEffect(() => { setIsLoading(true); void load() }, [load])

  const add = async () => {
    const cleanTitle = title.trim()
    if (!cleanTitle) { setError('Tên bước không được để trống.'); return }
    try { const { subtask } = await createSubtask(token, taskId, cleanTitle, onTokenRefresh); setSubtasks((current) => [...current, subtask]); setTitle(''); setError(''); onSubtasksChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể thêm bước.') }
  }
  const change = async (item: Subtask, changes: Partial<Pick<Subtask, 'title' | 'completed' | 'position'>>) => {
    try { const { subtask } = await updateSubtask(token, taskId, item.id, changes, onTokenRefresh); setSubtasks((current) => current.map((entry) => entry.id === item.id ? subtask : entry).sort((a, b) => a.position - b.position)); setError(''); onSubtasksChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể cập nhật bước.') }
  }
  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= subtasks.length) return
    const reordered = [...subtasks]
    const [item] = reordered.splice(index, 1)
    reordered.splice(nextIndex, 0, item)
    setSubtasks(reordered.map((entry, position) => ({ ...entry, position })))
    void change(item, { position: nextIndex }).then(() => load())
  }
  const remove = async (item: Subtask) => {
    try { await deleteSubtask(token, taskId, item.id, onTokenRefresh); setSubtasks((current) => current.filter((entry) => entry.id !== item.id)); setError(''); onSubtasksChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xóa bước.') }
  }
  const saveEdit = async (item: Subtask) => {
    const clean = editTitle.trim()
    if (!clean) { setError('Tên bước không được để trống.'); return }
    await change(item, { title: clean })
    setEditingId(null)
  }
  const completed = subtasks.filter((item) => item.completed).length

  return <section className="subtask-panel" aria-label="Checklist công việc"><div className="subtask-heading"><div><button type="button" className="subtask-collapse" aria-expanded={isExpanded} onClick={() => setIsExpanded((value) => !value)} aria-label={isExpanded ? 'Thu gọn checklist' : 'Mở checklist'}>{isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><h3>Checklist</h3><span>{completed}/{subtasks.length} hoàn thành</span></div><strong>{subtasks.length ? Math.round(completed / subtasks.length * 100) : 0}%</strong></div><div className="project-progress-track"><span style={{ width: `${subtasks.length ? completed / subtasks.length * 100 : 0}%` }} /></div>{isExpanded && <>{isLoading ? <p className="subtask-empty" role="status">Đang tải checklist...</p> : subtasks.length === 0 ? <p className="subtask-empty">Chưa có bước nào. Thêm bước nhỏ để bắt đầu.</p> : <ol className="subtask-list">{subtasks.map((item, index) => <li key={item.id} className={item.completed ? 'is-complete' : ''}><button type="button" className={`subtask-check ${item.completed ? 'checked' : ''}`} aria-label={item.completed ? `Đánh dấu chưa xong: ${item.title}` : `Hoàn thành bước: ${item.title}`} onClick={() => void change(item, { completed: !item.completed })}>{item.completed && <Check size={13} />}</button>{editingId === item.id ? <div className="subtask-edit-form"><input aria-label="Sửa tên bước" autoFocus maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveEdit(item) } }} /><button type="button" aria-label="Lưu tên bước" onClick={() => void saveEdit(item)}><Check size={14} /></button><button type="button" aria-label="Hủy sửa bước" onClick={() => setEditingId(null)}><X size={14} /></button></div> : <span className="subtask-title">{item.title}</span>}<div className="subtask-actions"><button type="button" disabled={index === 0} aria-label={`Đưa ${item.title} lên`} onClick={() => move(index, -1)}><ArrowUp size={13} /></button><button type="button" disabled={index === subtasks.length - 1} aria-label={`Đưa ${item.title} xuống`} onClick={() => move(index, 1)}><ArrowDown size={13} /></button><button type="button" aria-label={`Sửa ${item.title}`} onClick={() => { setEditingId(item.id); setEditTitle(item.title) }}><Pencil size={13} /></button><button type="button" aria-label={`Xóa ${item.title}`} onClick={() => void remove(item)}><Trash2 size={13} /></button></div></li>)}</ol>}<div className="subtask-add-form"><input aria-label="Tên bước mới" disabled={isLoading} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void add() } }} placeholder="Thêm một bước..." /><button type="button" aria-label="Thêm bước" disabled={isLoading || !title.trim()} onClick={() => void add()}><Plus size={15} /></button></div></>}{error && <p role="alert" className="subtask-error">{error}</p>}</section>
}
