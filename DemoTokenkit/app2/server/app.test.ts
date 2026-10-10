// @vitest-environment node
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app';
import { createDatabase } from './database';

const database = createDatabase(':memory:');
const app = createApp({ database, accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret' });
const agents: ReturnType<typeof request.agent>[] = [];

afterEach(() => {
  for (const agent of agents.splice(0)) void agent;
  database.exec('DELETE FROM refresh_sessions; DELETE FROM subtasks; DELETE FROM tasks; DELETE FROM projects; DELETE FROM users;');
});

async function registerUser(email: string, targetApp = app) {
  const response = await request(targetApp).post('/api/auth/register').send({ email, password: 'long-enough-password' });
  return { id: response.body.user.id as string, token: response.body.accessToken as string };
}

describe('Express authentication API', () => {
  it('rotates refresh tokens and revokes the session on logout', async () => {
    const agent = request.agent(app);
    agents.push(agent);

    const registration = await agent.post('/api/auth/register').send({ email: 'writer@example.com', password: 'long-enough-password' });
    expect(registration.status).toBe(201);
    expect(registration.body.user.email).toBe('writer@example.com');
    expect(registration.body.accessToken).toEqual(expect.any(String));
    expect(registration.headers['set-cookie'][0]).toContain('HttpOnly');

    const login = await agent.post('/api/auth/login').send({ email: ' WRITER@example.com ', password: 'long-enough-password' });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(registration.body.user.id);

    const me = await agent.get('/api/auth/me').set('Authorization', `Bearer ${registration.body.accessToken}`);
    expect(me.body.user).toEqual({ id: registration.body.user.id, email: 'writer@example.com' });

    const refresh = await agent.post('/api/auth/refresh');
    expect(refresh.status).toBe(200);
    expect(refresh.headers['set-cookie'][0]).not.toBe(login.headers['set-cookie'][0]);

    await agent.post('/api/auth/logout').expect(204);
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('rejects invalid credentials and short passwords', async () => {
    await request(app).post('/api/auth/register').send({ email: 'bad@example.com', password: 'short' }).expect(400);
    await request(app).post('/api/auth/login').send({ email: 'missing@example.com', password: 'long-enough-password' }).expect(401);
  });

  it('creates projects and tasks, manages subtasks, and protects every resource by owner', async () => {
    const owner = await registerUser('project-owner@example.com');
    const other = await registerUser('project-other@example.com');
    await request(app).get('/api/projects').expect(401);

    const createdProject = await request(app).post('/api/projects').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Launch', description: 'First release', color: '#df634d' }).expect(201);
    const projectId = createdProject.body.project.id as string;
    const createdTask = await request(app).post('/api/tasks').set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Write release notes', projectId, priority: 'high', status: 'todo' }).expect(201);
    const taskId = createdTask.body.task.id as string;
    expect(createdTask.body.task.projectId).toBe(projectId);

    const first = await request(app).post(`/api/tasks/${taskId}/subtasks`).set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Collect changes' }).expect(201);
    const second = await request(app).post(`/api/tasks/${taskId}/subtasks`).set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Proofread' }).expect(201);
    await request(app).post(`/api/tasks/${taskId}/subtasks`).set('Authorization', `Bearer ${owner.token}`).send({ title: '  ' }).expect(400);
    await request(app).patch(`/api/tasks/${taskId}/subtasks/${first.body.subtask.id}`).set('Authorization', `Bearer ${owner.token}`)
      .send({ completed: true }).expect(200);
    await request(app).patch(`/api/tasks/${taskId}/subtasks/reorder`).set('Authorization', `Bearer ${owner.token}`)
      .send({ ids: [second.body.subtask.id, first.body.subtask.id] }).expect(200);

    const details = await request(app).get(`/api/projects/${projectId}`).set('Authorization', `Bearer ${owner.token}`).expect(200);
    expect(details.body.tasks).toHaveLength(1);
    expect(details.body.tasks[0].id).toBe(taskId);
    const subtasks = await request(app).get(`/api/tasks/${taskId}/subtasks`).set('Authorization', `Bearer ${owner.token}`).expect(200);
    expect(subtasks.body.subtasks.map((item: { title: string }) => item.title)).toEqual(['Proofread', 'Collect changes']);
    expect(subtasks.body.subtasks[1].completed).toBe(true);

    await request(app).get(`/api/projects/${projectId}`).set('Authorization', `Bearer ${other.token}`).expect(404);
    await request(app).get(`/api/tasks/${taskId}/subtasks`).set('Authorization', `Bearer ${other.token}`).expect(404);
    await request(app).patch(`/api/tasks/${taskId}`).set('Authorization', `Bearer ${other.token}`).send({ title: 'Take over' }).expect(404);
    await request(app).patch(`/api/tasks/${taskId}/subtasks/${first.body.subtask.id}`).set('Authorization', `Bearer ${other.token}`).send({ completed: false }).expect(404);
  });

  it('requires a task disposition when deleting projects and preserves or deletes tasks explicitly', async () => {
    const owner = await registerUser('project-delete@example.com');
    const auth = { Authorization: `Bearer ${owner.token}` };
    const project = await request(app).post('/api/projects').set(auth).send({ name: 'Temporary' }).expect(201);
    const projectId = project.body.project.id as string;
    const task = await request(app).post('/api/tasks').set(auth).send({ title: 'Keep me', projectId, priority: 'low', status: 'todo' }).expect(201);

    await request(app).delete(`/api/projects/${projectId}`).set(auth).expect(400);
    await request(app).delete(`/api/projects/${projectId}?tasks=unassign`).set(auth).expect(204);
    const tasks = await request(app).get('/api/tasks?projectId=unassigned').set(auth).expect(200);
    expect(tasks.body.tasks.map((item: { id: string; projectId: string | null }) => ({ id: item.id, projectId: item.projectId })))
      .toEqual([{ id: task.body.task.id, projectId: null }]);

    const secondProject = await request(app).post('/api/projects').set(auth).send({ name: 'Delete contents' }).expect(201);
    const secondTask = await request(app).post('/api/tasks').set(auth).send({ title: 'Remove me', projectId: secondProject.body.project.id, priority: 'low', status: 'todo' }).expect(201);
    await request(app).post(`/api/tasks/${secondTask.body.task.id}/subtasks`).set(auth).send({ title: 'Nested data' }).expect(201);
    await request(app).delete(`/api/projects/${secondProject.body.project.id}?tasks=delete`).set(auth).expect(204);
    expect((await request(app).get('/api/tasks').set(auth)).body.tasks.map((item: { id: string }) => item.id)).not.toContain(secondTask.body.task.id);
    expect((database.prepare('SELECT COUNT(*) AS count FROM subtasks WHERE task_id = ?').get(secondTask.body.task.id) as { count: number }).count).toBe(0);
  });

  it('creates initial tasks from built-in project templates with customized details', async () => {
    const owner = await registerUser('template-owner@example.com');
    const auth = { Authorization: `Bearer ${owner.token}` };
    const templates = await request(app).get('/api/project-templates').set(auth).expect(200);
    expect(templates.body.templates.map((template: { id: string }) => template.id)).toEqual(['study', 'work', 'personal']);
    const created = await request(app).post('/api/projects/from-template').set(auth)
      .send({ templateId: 'study', name: 'Exam preparation', description: 'My semester plan', color: '#56846c' }).expect(201);
    expect(created.body.project.name).toBe('Exam preparation');
    const details = await request(app).get(`/api/projects/${created.body.project.id}`).set(auth).expect(200);
    expect(details.body.tasks.map((task: { title: string }) => task.title)).toEqual(templates.body.templates[0].tasks);
    await request(app).post('/api/projects/from-template').set(auth).send({ templateId: 'unknown', name: 'Invalid' }).expect(400);
  });

  it('updates and archives projects and calculates persisted task statistics from local dates', async () => {
    const owner = await registerUser('project-progress@example.com');
    const auth = { Authorization: `Bearer ${owner.token}` };
    const project = await request(app).post('/api/projects').set(auth).send({ name: 'Sprint' }).expect(201);
    const projectId = project.body.project.id as string;
    const today = new Date();
    today.setDate(today.getDate() - 1);
    const yesterday = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;
    const activeTask = await request(app).post('/api/tasks').set(auth)
      .send({ title: 'Late task', projectId, priority: 'medium', status: 'todo', dueDate: yesterday }).expect(201);
    await request(app).post('/api/tasks').set(auth)
      .send({ title: 'Finished task', projectId, priority: 'low', status: 'done' }).expect(201);
    const updatedTask = await request(app).patch(`/api/tasks/${activeTask.body.task.id}`).set(auth)
      .send({ title: 'Updated late task' }).expect(200);
    expect(updatedTask.body.task.title).toBe('Updated late task');
    await request(app).patch(`/api/tasks/${activeTask.body.task.id}`).set(auth).send({ dueDate: 'yesterday' }).expect(400);

    const listed = await request(app).get('/api/projects').set(auth).expect(200);
    expect(listed.body.projects[0]).toMatchObject({ total_count: 2, active_count: 1, completed_count: 1, overdue_count: 1 });
    await request(app).patch(`/api/projects/${projectId}`).set(auth).send({ name: 'Next sprint', archived: true }).expect(200);
    expect((await request(app).get('/api/projects').set(auth)).body.projects[0]).toMatchObject({ name: 'Next sprint', archived: 1 });
  });

  it('adds project_id to a legacy tasks table without replacing its records', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'viec-nho-migration-'));
    const file = path.join(directory, 'legacy.sqlite');
    const legacy = new Database(file);
    legacy.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)');
    legacy.prepare('INSERT INTO tasks VALUES (?, ?, ?)').run('kept-task', 'user-1', 'Keep this task');
    legacy.close();

    const migrated = createDatabase(file);
    expect(migrated.prepare('SELECT id, title, project_id FROM tasks').get()).toEqual({ id: 'kept-task', title: 'Keep this task', project_id: null });
    expect((migrated.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).some((column) => column.name === 'completed_at')).toBe(true);
    expect((migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'focus_sessions'").get() as { name: string }).name).toBe('focus_sessions');
    expect((migrated.prepare('PRAGMA foreign_key_list(tasks)').all() as Array<{ table: string }>).some((foreignKey) => foreignKey.table === 'projects')).toBe(true);
    expect(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'habits'").get()).toEqual({ name: 'habits' });
    expect((migrated.prepare('PRAGMA foreign_key_list(habit_completions)').all() as Array<{ table: string }>).some((foreignKey) => foreignKey.table === 'habits')).toBe(true);
    expect((migrated.prepare('PRAGMA index_list(habit_completions)').all() as Array<{ name: string }>).some((index) => index.name === 'sqlite_autoindex_habit_completions_1')).toBe(true);
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('records current completion timestamps and scopes analytics to the authenticated user', async () => {
    const testApp = createApp({ database, accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret' });
    const owner = await registerUser('analytics-owner@example.com', testApp);
    const other = await registerUser('analytics-other@example.com', testApp);
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const otherAuth = { Authorization: `Bearer ${other.token}` };

    await request(testApp).get('/api/analytics').expect(401);
    const project = await request(testApp).post('/api/projects').set(ownerAuth).send({ name: 'Analytics project' }).expect(201);
    const task = await request(testApp).post('/api/tasks').set(ownerAuth).send({
      title: 'Finish report', projectId: project.body.project.id, dueDate: '2026-01-01', priority: 'high', status: 'todo',
    }).expect(201);
    expect(task.body.task.completedAt).toBeNull();

    const completed = await request(testApp).patch(`/api/tasks/${task.body.task.id}`).set(ownerAuth).send({ status: 'done' }).expect(200);
    expect(completed.body.task.completedAt).toEqual(expect.any(String));
    database.prepare('UPDATE tasks SET created_at = ?, completed_at = ? WHERE id = ?')
      .run('2026-01-01T10:00:00.000Z', '2026-01-02T10:00:00.000Z', task.body.task.id);

    const analytics = await request(testApp).get('/api/analytics?from=2026-01-01&to=2026-01-03&timeZone=UTC')
      .set(ownerAuth).expect(200);
    expect(analytics.body.analytics.totals).toMatchObject({ created: 1, completed: 1, remaining: 0 });
    expect(analytics.body.analytics.onTime).toMatchObject({ completedOnTime: 0, completedLate: 1, eligible: 1, rate: 0 });
    expect(analytics.body.analytics.daily.find((item: { date: string }) => item.date === '2026-01-02').completed).toBe(1);
    await request(testApp).get(`/api/analytics?projectId=${project.body.project.id}`).set(otherAuth).expect(404);
    const reopened = await request(testApp).patch(`/api/tasks/${task.body.task.id}`).set(ownerAuth).send({ status: 'todo' }).expect(200);
    expect(reopened.body.task.completedAt).toBeNull();
    const afterReopen = await request(testApp).get('/api/analytics?from=2026-01-01&to=2026-01-03&timeZone=UTC')
      .set(ownerAuth).expect(200);
    expect(afterReopen.body.analytics.totals.completed).toBe(0);
  });

  it('manages habits, tracks unique dated completions, and enforces owner access', async () => {
    const testApp = createApp({ database, accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret' });
    const owner = await registerUser('habit-owner@example.com', testApp);
    const other = await registerUser('habit-other@example.com', testApp);
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    const date = new Date();
    date.setDate(date.getDate() - 2);
    const completionDate = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
    const startDate = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-01`;

    await request(testApp).get('/api/habits').expect(401);
    await request(testApp).post('/api/habits').set(ownerAuth)
      .send({ name: 'Đọc sách', frequency: 'weekly', weeklyTarget: 5, startDate, color: '#56846c' }).expect(201);
    await request(testApp).post('/api/habits').set(ownerAuth)
      .send({ name: 'Đi bộ', frequency: 'daily', startDate }).expect(201);
    await request(testApp).post('/api/habits').set(ownerAuth)
      .send({ name: 'Mục tiêu sai', frequency: 'weekly', weeklyTarget: 8, startDate }).expect(400);
    const habits = await request(testApp).get('/api/habits?archived=false').set(ownerAuth).expect(200);
    expect(habits.body.habits).toHaveLength(2);
    const habitId = habits.body.habits.find((habit: { name: string }) => habit.name === 'Đi bộ').id as string;

    await request(testApp).put(`/api/habits/${habitId}/completions/${completionDate}`).set(ownerAuth).expect(200);
    await request(testApp).put(`/api/habits/${habitId}/completions/${completionDate}`).set(ownerAuth).expect(200);
    expect((database.prepare('SELECT COUNT(*) AS count FROM habit_completions WHERE habit_id = ?').get(habitId) as { count: number }).count).toBe(1);
    await request(testApp).get(`/api/habits/${habitId}/completions?from=${startDate}&to=${completionDate}`).set(ownerAuth).expect(200)
      .expect(({ body }) => expect(body.completions.map((item: { date: string }) => item.date)).toEqual([completionDate]));

    await request(testApp).get(`/api/habits/${habitId}`).set(otherAuth).expect(404);
    await request(testApp).put(`/api/habits/${habitId}/completions/${completionDate}`).set(otherAuth).expect(404);
    await request(testApp).patch(`/api/habits/${habitId}`).set(ownerAuth).send({ name: 'Đi bộ ngoài trời' }).expect(200);
    await request(testApp).delete(`/api/habits/${habitId}/completions/${completionDate}`).set(ownerAuth).expect(204);
    await request(testApp).post(`/api/habits/${habitId}/archive`).set(ownerAuth).expect(200);
    expect((await request(testApp).get('/api/habits?archived=true').set(ownerAuth)).body.habits).toHaveLength(1);
    await request(testApp).delete(`/api/habits/${habitId}`).set(ownerAuth).expect(204);
  });

  it('validates focus sessions, prevents duplicates, and blocks cross-user access', async () => {
    const testApp = createApp({ database, accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret' });
    const owner = await registerUser('focus-owner@example.com', testApp);
    const other = await registerUser('focus-other@example.com', testApp);
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    const project = await request(testApp).post('/api/projects').set(ownerAuth).send({ name: 'Focus project' }).expect(201);
    const task = await request(testApp).post('/api/tasks').set(ownerAuth).send({ title: 'Deep work', projectId: project.body.project.id, priority: 'medium', status: 'todo' }).expect(201);

    await request(testApp).get('/api/focus-sessions/active').expect(401);
    await request(testApp).post('/api/focus-sessions').set(ownerAuth).send({ expectedDurationSeconds: 59 }).expect(400);
    await request(testApp).post('/api/focus-sessions').set(otherAuth)
      .send({ taskId: task.body.task.id, expectedDurationSeconds: 60 }).expect(404);
    const started = await request(testApp).post('/api/focus-sessions').set(ownerAuth)
      .send({ taskId: task.body.task.id, expectedDurationSeconds: 60 }).expect(201);
    const sessionId = started.body.session.id as string;
    expect(started.body.session.projectId).toBe(project.body.project.id);
    await request(testApp).post('/api/focus-sessions').set(ownerAuth).send({ expectedDurationSeconds: 60 }).expect(409);
    await request(testApp).post(`/api/focus-sessions/${sessionId}/pause`).set(otherAuth).expect(404);
    await request(testApp).post(`/api/focus-sessions/${sessionId}/pause`).set(ownerAuth).expect(200);
    await request(testApp).post(`/api/focus-sessions/${sessionId}/resume`).set(ownerAuth).expect(200);

    const activeStart = new Date(Date.now() - 60_000).toISOString();
    database.prepare('UPDATE focus_sessions SET active_started_at = ? WHERE id = ?').run(activeStart, sessionId);
    const completed = await request(testApp).post(`/api/focus-sessions/${sessionId}/complete`).set(ownerAuth).expect(200);
    expect(completed.body.session).toMatchObject({ status: 'completed', durationSeconds: 60 });
    await request(testApp).post(`/api/focus-sessions/${sessionId}/complete`).set(ownerAuth).expect(409);

    const invalidRange = await request(testApp).get('/api/analytics?from=2026-02-01&to=2026-01-01').set(ownerAuth).expect(400);
    expect(invalidRange.body.error).toContain('Khoảng ngày');
  });
});