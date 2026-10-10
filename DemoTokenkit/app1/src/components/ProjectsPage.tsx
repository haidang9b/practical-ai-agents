import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Archive, ArrowLeft, Check, ClipboardList, FolderKanban, Pencil, Plus, Trash2, X } from 'lucide-react'
import { createProject, createProjectFromTemplate, deleteProject, getProjects, getProjectTemplates, updateProject } from '../lib/api'
import type { Project, ProjectDraft, ProjectTemplate } from '../types/project'
import type { Task } from '../types/task'

const blankProject: ProjectDraft = { name: '', description: '', color: '#55836b' }

interface ProjectsPageProps {
  token: string
  onTokenRefresh: (token: string) => void
  tasks: Task[]
  onEditTask: (task: Task) => void
  onCreateTask: (projectId?: string) => void
  onProjectsChanged: () => Promise<void>
  onTasksChanged: () => void
}

function ProjectProgress({ project }: { project: Project }) {
  return <div className="project-progress"><div className="project-progress-label"><span>Tiến độ</span><strong>{project.progress}%</strong></div><div className="project-progress-track"><span style={{ width: `${project.progress}%`, background: project.color }} /></div></div>
}

function ProjectForm({ initial, onSave, onClose }: { initial: ProjectDraft; onSave: (draft: ProjectDraft) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try { await onSave({ ...draft, name: draft.name.trim() }) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu dự án.') } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="task-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="project-form-title"><div className="modal-heading"><div><p className="eyebrow"><span className="eyebrow-line" />KHÔNG GIAN MỚI</p><h2 id="project-form-title">{initial.name ? 'Chỉnh sửa dự án' : 'Tạo dự án'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={18} /></button></div><form onSubmit={(event) => void submit(event)}><label className="field-label">Tên dự án<input autoFocus required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field-label">Mô tả<textarea rows={3} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label className="field-label">Màu dự án<input className="project-color-input" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>{error && <p role="alert" className="task-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Hủy</button><button className="primary-button" disabled={saving}><Check size={16} />{saving ? 'Đang lưu...' : 'Lưu dự án'}</button></div></form></section></div>
}

function ProjectTemplateSelector({ templates, onCreate, onClose }: { templates: ProjectTemplate[]; onCreate: (template: ProjectTemplate, draft: ProjectDraft) => Promise<void>; onClose: () => void }) {
  const [selected, setSelected] = useState<ProjectTemplate | null>(null)
  const [draft, setDraft] = useState<ProjectDraft>(blankProject)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const choose = (template: ProjectTemplate) => { setSelected(template); setDraft({ name: template.name, description: template.description, color: template.color }) }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || saving) return
    setSaving(true)
    setError('')
    try { await onCreate(selected, draft) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo dự án từ mẫu.') } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="task-modal template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title"><div className="modal-heading"><div><p className="eyebrow"><span className="eyebrow-line" />BẮT ĐẦU CÓ ĐỊNH HƯỚNG</p><h2 id="template-title">Mẫu dự án</h2></div><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={18} /></button></div><div className="template-options">{templates.map((template) => <button key={template.id} className={`template-option ${selected?.id === template.id ? 'selected' : ''}`} onClick={() => choose(template)}><span className="template-swatch" style={{ background: template.color }} /><span><strong>{template.name}</strong><small>{template.description}</small></span></button>)}</div>{selected && <form className="template-preview" onSubmit={(event) => void submit(event)}><h3>Các bước khởi đầu</h3><ol>{selected.tasks.map((title) => <li key={title}>{title}</li>)}</ol><div className="field-grid"><label className="field-label">Tên dự án<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field-label">Màu<input className="project-color-input" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label></div><label className="field-label">Mô tả<textarea rows={2} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>{error && <p role="alert" className="task-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Đóng</button><button className="primary-button" disabled={saving}><Plus size={16} />{saving ? 'Đang tạo...' : 'Tạo cùng công việc'}</button></div></form>}</section></div>
}

export default function ProjectsPage({ token, onTokenRefresh, tasks, onEditTask, onCreateTask, onProjectsChanged, onTasksChanged }: ProjectsPageProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [formProject, setFormProject] = useState<Project | null | undefined>(undefined)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const initialTaskReference = useRef(tasks)

  const load = () => {
    setIsLoading(true)
    Promise.all([getProjects(token, onTokenRefresh), getProjectTemplates(token, onTokenRefresh)])
      .then(([projectResult, templateResult]) => { setProjects(projectResult.projects); setTemplates(templateResult.templates); setError('') })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Không thể tải dự án.'))
      .finally(() => setIsLoading(false))
  }
  useEffect(load, [token, onTokenRefresh])
  useEffect(() => {
    if (initialTaskReference.current === tasks) return
    initialTaskReference.current = tasks
    let isCurrent = true
    getProjects(token, onTokenRefresh).then(({ projects: loaded }) => { if (isCurrent) setProjects(loaded) })
      .catch((cause: unknown) => { if (isCurrent) setError(cause instanceof Error ? cause.message : 'Không thể cập nhật tiến độ dự án.') })
    return () => { isCurrent = false }
  }, [tasks, token, onTokenRefresh])

  const save = async (draft: ProjectDraft) => {
    if (formProject) await updateProject(token, formProject.id, draft, onTokenRefresh)
    else await createProject(token, draft, onTokenRefresh)
    setFormProject(undefined)
    load()
    await onProjectsChanged()
  }
  const createFromTemplate = async (template: ProjectTemplate, draft: ProjectDraft) => {
    await createProjectFromTemplate(token, { templateId: template.id, ...draft }, onTokenRefresh)
    setShowTemplates(false)
    load()
    onTasksChanged()
  }
  const archive = async (project: Project) => {
    await updateProject(token, project.id, { archived: !project.archived }, onTokenRefresh)
    load()
    await onProjectsChanged()
  }
  const remove = async (project: Project, behavior: 'unassign' | 'delete') => {
    const warning = behavior === 'delete' ? `Xóa dự án “${project.name}” và ${project.totalTasks} công việc liên quan? Hành động này không thể hoàn tác.` : `Xóa dự án “${project.name}” và chuyển ${project.totalTasks} công việc sang chưa gán?`
    if (!window.confirm(warning)) return
    try { await deleteProject(token, project.id, behavior, onTokenRefresh); setSelectedId(null); load(); onTasksChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xóa dự án.') }
  }

  const visibleProjects = projects.filter((project) => showArchived || !project.archived)
  const selectedProject = projects.find((project) => project.id === selectedId)
  const projectTasks = tasks.filter((task) => task.projectId === selectedId)

  return <section className="projects-page" aria-label="Quản lý dự án">
    <div className="projects-toolbar"><span>{projects.filter((project) => !project.archived).length} dự án đang hoạt động</span><div><label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Hiện đã lưu trữ</label><button className="secondary-button" onClick={() => setShowTemplates(true)}><ClipboardList size={15} />Dùng mẫu</button><button className="primary-button" onClick={() => setFormProject(null)}><Plus size={16} />Tạo dự án</button></div></div>
    {error && <p role="alert" className="task-error">{error}</p>}
    {isLoading ? <div className="projects-empty" role="status">Đang tải dự án...</div> : selectedProject ? <div className="project-detail"><button className="text-button" onClick={() => setSelectedId(null)}><ArrowLeft size={15} />Tất cả dự án</button><header className="project-detail-heading"><span className="project-mark" style={{ background: selectedProject.color }} /><div><p className="eyebrow"><span className="eyebrow-line" />DỰ ÁN</p><h2>{selectedProject.name}</h2><p>{selectedProject.description || 'Chưa có mô tả.'}</p></div><button className="primary-button" onClick={() => onCreateTask(selectedProject.id)}><Plus size={15} />Thêm công việc</button></header><ProjectProgress project={selectedProject} /><div className="project-stats"><div><strong>{selectedProject.totalTasks}</strong><span>Tổng việc</span></div><div><strong>{selectedProject.activeTasks}</strong><span>Đang làm</span></div><div><strong>{selectedProject.completedTasks}</strong><span>Hoàn tất</span></div><div><strong>{selectedProject.overdueTasks}</strong><span>Quá hạn</span></div></div><div className="project-task-list"><div className="section-title-line"><h3>Công việc trong dự án</h3><span className="task-total">{projectTasks.length}</span></div>{projectTasks.length ? projectTasks.map((task) => <button className="project-task-row" key={task.id} onClick={() => onEditTask(task)}><span className={task.completed ? 'project-task-check done' : 'project-task-check'}>{task.completed && <Check size={12} />}</span><span>{task.title}</span><small>{task.completed ? 'Hoàn tất' : task.dueDate || 'Chưa có hạn'}</small><Pencil size={14} /></button>) : <p className="projects-empty">Dự án chưa có công việc.</p>}</div><div className="project-detail-actions"><button className="secondary-button" onClick={() => setFormProject(selectedProject)}><Pencil size={14} />Chỉnh sửa</button><button className="secondary-button" onClick={() => void archive(selectedProject)}><Archive size={14} />{selectedProject.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}</button><button className="danger-button" onClick={() => void remove(selectedProject, 'unassign')}><Trash2 size={14} />Xóa, giữ công việc</button><button className="danger-button" onClick={() => void remove(selectedProject, 'delete')}><Trash2 size={14} />Xóa cả công việc</button></div></div> : visibleProjects.length ? <div className="project-grid">{visibleProjects.map((project) => <button key={project.id} className="project-card" onClick={() => setSelectedId(project.id)}><div className="project-card-top"><span className="project-mark" style={{ background: project.color }} /><span className="project-created">{new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(project.createdAt))}</span></div><h2>{project.name}</h2><p>{project.description || 'Chưa có mô tả.'}</p><ProjectProgress project={project} /><div className="project-card-footer"><span>{project.totalTasks} công việc</span><span>{project.completedTasks} hoàn tất</span></div></button>)}</div> : <div className="projects-empty"><FolderKanban size={25} /><h3>Chưa có dự án</h3><p>Tạo không gian riêng hoặc bắt đầu từ một mẫu có sẵn.</p><button className="primary-button" onClick={() => setShowTemplates(true)}><ClipboardList size={15} />Chọn mẫu</button></div>}
    {formProject !== undefined && <ProjectForm initial={formProject ? { name: formProject.name, description: formProject.description, color: formProject.color } : blankProject} onSave={save} onClose={() => setFormProject(undefined)} />}
    {showTemplates && <ProjectTemplateSelector templates={templates} onCreate={createFromTemplate} onClose={() => setShowTemplates(false)} />}
  </section>
}
