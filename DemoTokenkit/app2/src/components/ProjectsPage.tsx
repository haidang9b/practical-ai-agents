import { useEffect, useState, type FormEvent } from 'react';
import { Archive, ArrowLeft, Check, ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { Project, ProjectTemplate, Task } from '../types';

interface ProjectsPageProps {
  projects: Project[];
  onProjectsChange: () => void;
  onEditTask: (task: Task) => void;
}

interface ProjectDraft {
  name: string;
  description: string;
  color: string;
}

const blankProject: ProjectDraft = { name: '', description: '', color: '#56846c' };

export function ProjectProgress({ project }: { project: Project }) {
  const percent = project.total_count ? Math.round(project.completed_count / project.total_count * 100) : 0;
  return <div className="project-progress">
    <div className="project-progress-label"><span>Tiến độ</span><strong>{percent}%</strong></div>
    <div className="project-progress-track" role="progressbar" aria-label={`Tiến độ ${project.name}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${percent}%`, backgroundColor: project.color }} />
    </div>
  </div>;
}

function ProjectForm({
  project,
  onSave,
  onCancel,
}: {
  project: ProjectDraft;
  onSave: (draft: ProjectDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    setError('');
    try { await onSave(draft); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu dự án.'); }
    finally { setBusy(false); }
  }
  return <form className="project-form" onSubmit={submit}>
    <label className="form-label" htmlFor="project-name">Tên dự án <span>*</span></label>
    <input id="project-name" className="form-control" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={120} required autoFocus />
    <label className="form-label" htmlFor="project-description">Mô tả</label>
    <textarea id="project-description" className="form-control" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={2000} rows={3} />
    <label className="form-label" htmlFor="project-color">Màu dự án</label>
    <div className="project-color-row"><input id="project-color" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><span>{draft.color.toUpperCase()}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel}>Hủy</button><button className="primary-button" disabled={busy} type="submit"><Check size={15} />{busy ? 'Đang lưu...' : 'Lưu dự án'}</button></div>
  </form>;
}

function ProjectTemplateSelector({
  templates,
  onCreate,
  onCancel,
}: {
  templates: ProjectTemplate[];
  onCreate: (template: ProjectTemplate, draft: ProjectDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(templates[0]);
  const [draft, setDraft] = useState<ProjectDraft>({ name: templates[0]?.name ?? '', description: templates[0]?.description ?? '', color: templates[0]?.color ?? '#56846c' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function choose(template: ProjectTemplate) {
    setSelected(template);
    setDraft({ name: template.name, description: template.description, color: template.color });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy || !draft.name.trim()) return;
    setBusy(true);
    setError('');
    try { await onCreate(selected, draft); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo dự án từ mẫu.'); }
    finally { setBusy(false); }
  }
  if (!selected) return <p role="alert">Không tải được mẫu dự án.</p>;
  return <div className="template-layout">
    <div className="template-picker" role="tablist" aria-label="Mẫu dự án">
      {templates.map((template) => <button type="button" role="tab" aria-selected={selected.id === template.id} className={selected.id === template.id ? 'is-selected' : ''} key={template.id} onClick={() => choose(template)}>
        <span className="template-swatch" style={{ backgroundColor: template.color }} />{template.name}
      </button>)}
    </div>
    <form className="template-preview" onSubmit={submit}>
      <div className="template-preview-heading"><span className="template-swatch" style={{ backgroundColor: selected.color }} /><div><h3>{selected.name}</h3><p>{selected.description}</p></div></div>
      <p className="template-task-label">Công việc khởi tạo</p>
      <ol>{selected.tasks.map((task) => <li key={task}>{task}</li>)}</ol>
      <label className="form-label" htmlFor="template-project-name">Tên dự án</label><input id="template-project-name" className="form-control" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={120} required />
      <label className="form-label" htmlFor="template-project-description">Mô tả</label><textarea id="template-project-description" className="form-control" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} maxLength={2000} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel}>Hủy</button><button className="primary-button" type="submit" disabled={busy}><Plus size={15} />{busy ? 'Đang tạo...' : 'Tạo dự án'}</button></div>
    </form>
  </div>;
}

export default function ProjectsPage({ projects, onProjectsChange, onEditTask }: ProjectsPageProps) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templateError, setTemplateError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<'create' | 'edit' | 'template' | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Project | null>(null);
  const [details, setDetails] = useState<{ project: Project; tasks: Task[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{ templates: ProjectTemplate[] }>('/project-templates')
      .then(({ templates: items }) => setTemplates(items))
      .catch((reason: unknown) => setTemplateError(reason instanceof Error ? reason.message : 'Không tải được mẫu dự án.'));
  }, []);

  useEffect(() => {
    if (!selected) { setDetails(null); return; }
    let active = true;
    setDetails(null);
    apiRequest<{ project: Project; tasks: Task[] }>(`/projects/${encodeURIComponent(selected.id)}`)
      .then((data) => { if (active) setDetails(data); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Không tải được dự án.'); });
    return () => { active = false; };
  }, [selected]);

  async function createProject(draft: ProjectDraft) {
    await apiRequest('/projects', { method: 'POST', body: JSON.stringify(draft) });
    setForm(null);
    onProjectsChange();
  }
  async function saveProject(draft: ProjectDraft) {
    if (!editing) return;
    await apiRequest(`/projects/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body: JSON.stringify(draft) });
    setForm(null);
    setEditing(null);
    onProjectsChange();
  }
  async function createFromTemplate(template: ProjectTemplate, draft: ProjectDraft) {
    await apiRequest('/projects/from-template', { method: 'POST', body: JSON.stringify({ templateId: template.id, ...draft }) });
    setForm(null);
    onProjectsChange();
  }
  async function archiveProject(project: Project) {
    await apiRequest(`/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: JSON.stringify({ archived: !project.archived }) });
    onProjectsChange();
  }
  async function deleteProject(disposition?: 'unassign' | 'delete') {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest<void>(`/projects/${encodeURIComponent(deleteTarget.id)}${disposition ? `?tasks=${disposition}` : ''}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setSelected(null);
      onProjectsChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa dự án.');
    } finally { setBusy(false); }
  }

  const shown = projects.filter((project) => Boolean(project.archived) === showArchived);
  return <section className="projects-page">
    {selected ? <>
      <button className="project-back-button" onClick={() => setSelected(null)}><ArrowLeft size={15} />Tất cả dự án</button>
      {!details ? <p className="project-state">Đang tải dự án...</p> : <>
        <header className="project-detail-heading"><span className="project-large-mark" style={{ backgroundColor: details.project.color }} /><div><p className="eyebrow">DỰ ÁN</p><h2>{details.project.name}</h2><p>{details.project.description || 'Chưa có mô tả.'}</p></div>
          <button className="icon-button" aria-label="Sửa dự án" onClick={() => { setEditing(details.project); setForm('edit'); }}><Pencil size={15} /></button></header>
        <ProjectProgress project={{ ...details.project, total_count: details.tasks.length, completed_count: details.tasks.filter((task) => task.completed).length }} />
        <div className="project-stat-line"><span>{details.tasks.length} tổng</span><span>{details.tasks.filter((task) => !task.completed).length} đang làm</span><span>{details.tasks.filter((task) => task.completed).length} hoàn thành</span></div>
        <div className="project-task-list"><div className="project-task-heading"><h3>Công việc trong dự án</h3><span>{details.tasks.length}</span></div>
          {details.tasks.map((task) => <button className="project-task-row" key={task.id} onClick={() => onEditTask(task)}><span className={task.completed ? 'project-task-check done' : 'project-task-check'}>{task.completed ? <Check size={12} /> : null}</span><span>{task.title}</span><Pencil size={13} /></button>)}
          {details.tasks.length === 0 && <p className="project-state">Dự án chưa có công việc. Hãy gán việc từ biểu mẫu công việc.</p>}
        </div>
      </>}
    </> : <>
      <div className="projects-toolbar"><div><p className="eyebrow">TỔ CHỨC CÔNG VIỆC</p><h2>Dự án <span>{shown.length}</span></h2></div><div className="projects-actions"><label className="archived-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Đã lưu trữ</label><button className="secondary-button" onClick={() => setForm('template')}><ClipboardList size={14} />Từ mẫu</button><button className="primary-button" onClick={() => setForm('create')}><Plus size={16} />Tạo dự án</button></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {shown.length ? <div className="project-grid">{shown.map((project) => {
        const percent = project.total_count ? Math.round(project.completed_count / project.total_count * 100) : 0;
        return <article className="project-card" key={project.id}>
          <button className="project-card-main" onClick={() => setSelected(project)}><span className="project-card-color" style={{ backgroundColor: project.color }} /><span className="project-card-copy"><strong>{project.name}</strong><small>{project.description || 'Chưa có mô tả.'}</small></span><span className="project-card-date">Tạo {new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(project.created_at))}</span></button>
          <div className="project-card-stats"><span>{project.total_count} tổng</span><span>{project.active_count} đang làm</span><span>{project.completed_count} xong</span><span className="overdue-count">{project.overdue_count} quá hạn</span></div>
          <div className="project-progress-label"><span>Tiến độ</span><strong>{percent}%</strong></div><div className="project-progress-track"><span style={{ width: `${percent}%`, backgroundColor: project.color }} /></div>
          <div className="project-card-actions"><button aria-label={`Sửa ${project.name}`} title="Sửa" onClick={() => { setEditing(project); setForm('edit'); }}><Pencil size={14} /></button><button aria-label={`${project.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'} ${project.name}`} title={project.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'} onClick={() => void archiveProject(project)}><Archive size={14} /></button><button aria-label={`Xóa ${project.name}`} title="Xóa" onClick={() => setDeleteTarget(project)}><Trash2 size={14} /></button></div>
        </article>;
      })}</div> : <div className="projects-empty"><ClipboardList size={23} /><h3>{showArchived ? 'Chưa có dự án lưu trữ' : 'Chưa có dự án nào'}</h3><p>Tạo dự án để nhóm công việc và theo dõi tiến độ.</p></div>}
    </>}

    {form && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setForm(null); }}><section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
      <div className="dialog-heading"><div><span className="eyebrow">KHÔNG GIAN CỦA BẠN</span><h2 id="project-dialog-title">{form === 'template' ? 'Bắt đầu từ mẫu' : form === 'edit' ? 'Chỉnh sửa dự án' : 'Tạo dự án mới'}</h2></div><button className="icon-button" aria-label="Đóng" onClick={() => setForm(null)}><X size={17} /></button></div>
      {form === 'template' ? templateError ? <p className="form-error" role="alert">{templateError}</p> : <ProjectTemplateSelector templates={templates} onCreate={createFromTemplate} onCancel={() => setForm(null)} /> : <ProjectForm project={form === 'edit' && editing ? { name: editing.name, description: editing.description, color: editing.color } : blankProject} onSave={form === 'edit' ? saveProject : createProject} onCancel={() => setForm(null)} />}
    </section></div>}

    {deleteTarget && <div className="dialog-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title"><h2 id="delete-project-title">Xóa “{deleteTarget.name}”?</h2><p>{deleteTarget.total_count ? 'Chọn cách xử lý công việc thuộc dự án này.' : 'Dự án này sẽ bị xóa vĩnh viễn.'}</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDeleteTarget(null)}>Hủy</button>{deleteTarget.total_count > 0 ? <><button className="secondary-button" disabled={busy} onClick={() => void deleteProject('unassign')}>Chuyển sang chưa phân loại</button><button className="danger-button" disabled={busy} onClick={() => void deleteProject('delete')}>Xóa cả công việc</button></> : <button className="danger-button" disabled={busy} onClick={() => void deleteProject()}>Xóa dự án</button>}</div></section></div>}
  </section>;
}