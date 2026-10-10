import { useMemo, useState, type DragEvent } from 'react';
import { CalendarDays, ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react';
import { boardColumns, filterAndSortTasks, type BoardFilters } from '../lib/kanban';
import type { BoardSort, BoardStatus, Priority, Task } from '../types';

interface KanbanBoardProps {
  tasks: Task[];
  onCreate: () => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, status: BoardStatus) => void;
}

const priorityLabel: Record<Priority, string> = { low: 'Thấp', medium: 'Vừa', high: 'Cao' };
const statusLabel: Record<BoardStatus, string> = { todo: 'Cần làm', in_progress: 'Đang thực hiện', done: 'Đã xong' };
const emptyFilters: BoardFilters = { project: '', tag: '', priority: 'all', due: 'all', query: '' };

function dateLabel(date: string): string {
  if (!date) return 'Chưa đặt hạn';
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

export default function KanbanBoard({ tasks, onCreate, onEdit, onDelete, onMove }: KanbanBoardProps) {
  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
  const [sort, setSort] = useState<BoardSort>('due');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<BoardStatus | null>(null);
  const projects = useMemo(() => [...new Set(tasks.map((task) => task.project).filter(Boolean))].sort(), [tasks]);
  const tags = useMemo(() => [...new Set(tasks.flatMap((task) => task.tags))].sort(), [tasks]);
  const today = new Date().toISOString().slice(0, 10);
  const visibleTasks = useMemo(() => filterAndSortTasks(tasks, filters, sort, today), [tasks, filters, sort, today]);
  const hasFilters = Boolean(filters.project || filters.tag || filters.priority !== 'all' || filters.due !== 'all' || filters.query);

  function handleDrop(event: DragEvent<HTMLElement>, status: BoardStatus) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || draggedId;
    const task = tasks.find((candidate) => candidate.id === id);
    if (task && task.status !== status) onMove(task.id, status);
    setDraggedId(null);
    setDropTarget(null);
  }

  return (
    <section className="kanban-section" aria-label="Bảng Kanban">
      <div className="kanban-toolbar">
        <label className="kanban-search"><span className="sr-only">Tìm công việc</span><input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Tìm theo tên hoặc mô tả..." />{filters.query && <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setFilters({ ...filters, query: '' })}><X size={14} /></button>}</label>
        <label><span className="sr-only">Lọc dự án</span><select aria-label="Lọc dự án" value={filters.project} onChange={(event) => setFilters({ ...filters, project: event.target.value })}><option value="">Mọi dự án</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></label>
        <label><span className="sr-only">Lọc thẻ</span><select aria-label="Lọc thẻ" value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })}><option value="">Mọi thẻ</option>{tags.map((tag) => <option key={tag}>{tag}</option>)}</select></label>
        <label><span className="sr-only">Lọc ưu tiên</span><select aria-label="Lọc ưu tiên" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value as BoardFilters['priority'] })}><option value="all">Mọi mức ưu tiên</option><option value="high">Cao</option><option value="medium">Vừa</option><option value="low">Thấp</option></select></label>
        <label><span className="sr-only">Lọc hạn hoàn thành</span><select aria-label="Lọc hạn hoàn thành" value={filters.due} onChange={(event) => setFilters({ ...filters, due: event.target.value as BoardFilters['due'] })}><option value="all">Mọi hạn</option><option value="overdue">Quá hạn</option><option value="today">Hôm nay</option><option value="upcoming">Sắp tới</option><option value="none">Chưa đặt hạn</option></select></label>
        <label><span className="sr-only">Sắp xếp thẻ</span><select aria-label="Sắp xếp thẻ" value={sort} onChange={(event) => setSort(event.target.value as BoardSort)}><option value="due">Hạn gần nhất</option><option value="priority">Ưu tiên cao nhất</option><option value="created">Mới tạo trước</option></select></label>
        {hasFilters && <button className="kanban-clear" onClick={() => setFilters(emptyFilters)}>Xóa bộ lọc</button>}
      </div>
      <div className="kanban-columns">
        {boardColumns.map(({ status, title }) => {
          const columnTasks = visibleTasks.filter((task) => task.status === status);
          return (
            <section key={status} className={`kanban-column ${dropTarget === status ? 'is-drop-target' : ''}`} aria-label={`${title}, ${columnTasks.length} công việc`} onDragOver={(event) => { event.preventDefault(); setDropTarget(status); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }} onDrop={(event) => handleDrop(event, status)}>
              <header className="kanban-column-heading"><div><span className={`kanban-status-dot status-${status}`} /><h2>{title}</h2><span className="kanban-count" aria-label={`${columnTasks.length} công việc`}>{columnTasks.length}</span></div>{status === 'todo' && <button aria-label="Thêm công việc" title="Thêm công việc" onClick={onCreate}><Plus size={16} /></button>}</header>
              <div className="kanban-card-list" aria-live="polite">
                {columnTasks.map((task) => {
                  const overdue = task.status !== 'done' && Boolean(task.dueDate) && task.dueDate < today;
                  return (
                    <article className={`kanban-card priority-card-${task.priority} ${overdue ? 'is-overdue' : ''} ${draggedId === task.id ? 'is-dragging' : ''}`} key={task.id} draggable onDragStart={(event) => { setDraggedId(task.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); }} onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}>
                      <div className="kanban-card-topline"><span className={`kanban-priority priority-${task.priority}`}>{priorityLabel[task.priority]}</span><div className="kanban-card-actions"><button aria-label={`Xem và sửa: ${task.title}`} title="Xem chi tiết / sửa" onClick={() => onEdit(task)}><Pencil size={14} /></button><button aria-label={`Xóa: ${task.title}`} title="Xóa" onClick={() => onDelete(task.id)}><Trash2 size={14} /></button></div></div>
                      <button className="kanban-card-title" onClick={() => onEdit(task)}>{task.title}</button>
                      {task.description && <p className="kanban-card-description">{task.description}</p>}
                      <div className="kanban-card-project">{task.project || task.category}</div>
                      {task.tags.length > 0 && <div className="kanban-tags">{task.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                      <div className={`kanban-card-due ${overdue ? 'is-overdue' : ''}`}><CalendarDays size={13} /><span>{overdue ? 'Quá hạn · ' : ''}{dateLabel(task.dueDate)}</span></div>
                      <label className="kanban-status-select-label"><span>Trạng thái</span><select aria-label={`Trạng thái: ${task.title}`} value={task.status} onChange={(event) => onMove(task.id, event.target.value as BoardStatus)}>{boardColumns.map((column) => <option key={column.status} value={column.status}>{statusLabel[column.status]}</option>)}</select></label>
                    </article>
                  );
                })}
                {columnTasks.length === 0 && <div className="kanban-empty"><ClipboardList size={18} /><span>{hasFilters ? 'Không có việc phù hợp' : 'Chưa có công việc'}</span></div>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}