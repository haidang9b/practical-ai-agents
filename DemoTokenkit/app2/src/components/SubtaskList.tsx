import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { Subtask } from '../types';

interface SubtaskListProps {
  taskId: string;
}

export default function SubtaskList({ taskId }: SubtaskListProps) {
  const [items, setItems] = useState<Subtask[]>([]);
  const [title, setTitle] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest<{ subtasks: Subtask[] }>(`/tasks/${encodeURIComponent(taskId)}/subtasks`)
      .then(({ subtasks }) => { if (active) setItems(subtasks); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Không tải được danh sách việc con.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [taskId]);

  async function addSubtask() {
    const cleanTitle = title.trim();
    if (!cleanTitle || busy) return;
    setBusy(true);
    setError('');
    try {
      const { subtask } = await apiRequest<{ subtask: Subtask }>(`/tasks/${encodeURIComponent(taskId)}/subtasks`, {
        method: 'POST', body: JSON.stringify({ title: cleanTitle }),
      });
      setItems((current) => [...current, subtask]);
      setTitle('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể thêm việc con.');
    } finally {
      setBusy(false);
    }
  }

  async function updateSubtask(item: Subtask, changes: Partial<Subtask>) {
    try {
      const { subtask } = await apiRequest<{ subtask: Subtask }>(`/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(item.id)}`, {
        method: 'PATCH', body: JSON.stringify(changes),
      });
      setItems((current) => current.map((candidate) => candidate.id === item.id ? subtask : candidate));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật việc con.');
    }
  }

  async function removeSubtask(item: Subtask) {
    if (!window.confirm(`Xóa việc con “${item.title}”?`)) return;
    try {
      await apiRequest<void>(`/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa việc con.');
    }
  }

  async function saveTitle(item: Subtask) {
    const cleanTitle = editingTitle.trim();
    if (!cleanTitle) {
      setError('Tên việc con không được để trống.');
      return;
    }
    await updateSubtask(item, { title: cleanTitle });
    setEditingId(null);
  }

  async function move(item: Subtask, direction: -1 | 1) {
    const ordered = [...items].sort((first, second) => first.position - second.position);
    const index = ordered.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const next = ordered.map((candidate, position) => ({ ...candidate, position }));
    setItems(next);
    try {
      await apiRequest(`/tasks/${encodeURIComponent(taskId)}/subtasks/reorder`, {
        method: 'PATCH', body: JSON.stringify({ ids: next.map((candidate) => candidate.id) }),
      });
    } catch (reason) {
      setItems(items);
      setError(reason instanceof Error ? reason.message : 'Không thể đổi thứ tự việc con.');
    }
  }

  const completed = items.filter((item) => item.completed).length;
  return (
    <section className="subtask-section" aria-label="Danh sách việc con">
      <button className="subtask-heading" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span>Việc con</span><span className="subtask-progress">{completed}/{items.length} hoàn thành</span>
      </button>
      {expanded && <>
        {loading ? <p className="subtask-state">Đang tải checklist...</p> : items.length > 0 && <ul className="subtask-list">
          {[...items].sort((first, second) => first.position - second.position).map((item, index) => (
            <li className="subtask-item" key={item.id}>
              <input type="checkbox" aria-label={`Hoàn thành: ${item.title}`} checked={item.completed} onChange={(event) => void updateSubtask(item, { completed: event.target.checked })} />
              {editingId === item.id ? <input className="subtask-edit-control" aria-label={`Sửa tên: ${item.title}`} value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} maxLength={300} /> : <span className={item.completed ? 'is-subtask-complete' : ''}>{item.title}</span>}
              {editingId === item.id ? <>
                <button type="button" aria-label="Lưu tên việc con" title="Lưu" onClick={() => void saveTitle(item)}><Check size={14} /></button>
                <button type="button" aria-label="Hủy sửa việc con" title="Hủy" onClick={() => setEditingId(null)}><X size={14} /></button>
              </> : <>
                <button type="button" aria-label={`Sửa ${item.title}`} title="Sửa tên" onClick={() => { setEditingId(item.id); setEditingTitle(item.title); }}><Pencil size={13} /></button>
                <button type="button" aria-label={`Đưa ${item.title} lên`} title="Đưa lên" disabled={index === 0} onClick={() => void move(item, -1)}><ChevronUp size={14} /></button>
                <button type="button" aria-label={`Đưa ${item.title} xuống`} title="Đưa xuống" disabled={index === items.length - 1} onClick={() => void move(item, 1)}><ChevronDown size={14} /></button>
                <button type="button" aria-label={`Xóa ${item.title}`} title="Xóa việc con" onClick={() => void removeSubtask(item)}><Trash2 size={13} /></button>
              </>}
            </li>
          ))}
        </ul>}
        {!loading && items.length === 0 && <p className="subtask-state">Chưa có việc con.</p>}
        <div className="subtask-form">
          <input aria-label="Tên việc con mới" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Thêm một bước nhỏ..." maxLength={300} />
          <button type="button" aria-label="Thêm việc con" disabled={busy || !title.trim()} onClick={() => void addSubtask()}><Plus size={15} /></button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </>}
    </section>
  );
}