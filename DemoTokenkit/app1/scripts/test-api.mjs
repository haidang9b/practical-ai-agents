import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const baseUrl = process.env.API_URL ?? 'http://localhost:3001'

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie')
  assert.ok(cookie, 'Expected the API to set a refresh cookie')
  return cookie.split(';')[0]
}

const firstUser = {
  displayName: 'API Test',
  email: `auth-${randomUUID()}@example.com`,
  password: 'localtest123',
}

const registration = await request('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(firstUser),
})
assert.equal(registration.response.status, 201)
assert.ok(registration.body.accessToken)
assert.match(registration.response.headers.get('set-cookie'), /HttpOnly/i)
const firstRefreshCookie = cookieFrom(registration.response)

const createdTask = await request('/api/tasks', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${registration.body.accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ title: 'private task', category: 'Công việc', priority: 'high', dueDate: '2026-04-20', scheduledAt: '2026-04-15T09:30', project: 'Website', tags: ['api', 'urgent'] }),
})
assert.equal(createdTask.response.status, 201)
assert.equal(createdTask.body.task.status, 'todo')
assert.equal(createdTask.body.task.project, 'Website')
assert.deepEqual(createdTask.body.task.tags, ['api', 'urgent'])

const scheduledTask = await request(`/api/tasks/${createdTask.body.task.id}`, {
  method: 'PATCH',
  headers: {
    authorization: `Bearer ${registration.body.accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ scheduledAt: '2026-04-16T09:30' }),
})
assert.equal(scheduledTask.response.status, 200)
assert.equal(scheduledTask.body.task.scheduledAt, '2026-04-16T09:30')
assert.equal(scheduledTask.body.task.dueDate, '2026-04-20')
const loadedScheduledTasks = await request('/api/tasks', {
  headers: { authorization: `Bearer ${registration.body.accessToken}` },
})
assert.equal(loadedScheduledTasks.body.tasks[0].scheduledAt, '2026-04-16T09:30')
assert.equal(loadedScheduledTasks.body.tasks[0].status, 'todo')

const movedTask = await request(`/api/tasks/${createdTask.body.task.id}`, {
  method: 'PATCH',
  headers: {
    authorization: `Bearer ${registration.body.accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ status: 'in_progress' }),
})
assert.equal(movedTask.response.status, 200)
assert.equal(movedTask.body.task.status, 'in_progress')
assert.equal(movedTask.body.task.completed, false)
assert.equal(movedTask.body.task.title, 'private task')
assert.equal(movedTask.body.task.project, 'Website')
assert.deepEqual(movedTask.body.task.tags, ['api', 'urgent'])

const completedTask = await request(`/api/tasks/${createdTask.body.task.id}`, {
  method: 'PATCH',
  headers: {
    authorization: `Bearer ${registration.body.accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ completed: true }),
})
assert.equal(completedTask.body.task.status, 'done')
assert.equal(completedTask.body.task.completed, true)
assert.ok(completedTask.body.task.completedAt)
const today = new Date().toISOString().slice(0, 10)
const editedCompletedDeadline = await request(`/api/tasks/${createdTask.body.task.id}`, {
  method: 'PATCH', headers: { authorization: `Bearer ${registration.body.accessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ dueDate: today }),
})
assert.equal(editedCompletedDeadline.body.task.completedAt, completedTask.body.task.completedAt)
const analytics = await request(`/api/analytics?startDate=2026-01-01&endDate=${today}&timezone=UTC`, { headers: { authorization: `Bearer ${registration.body.accessToken}` } })
assert.equal(analytics.response.status, 200)
assert.equal(analytics.body.totals.completed, 1)
assert.equal(analytics.body.onTime.completedLate, 1)
assert.equal(analytics.body.onTime.rate, 0)
assert.equal(analytics.body.streak.activity.at(-1).date, today)
assert.equal((await request('/api/analytics', {})).response.status, 401)
assert.equal((await request('/api/analytics?startDate=2026-02-02&endDate=2026-01-01', { headers: { authorization: `Bearer ${registration.body.accessToken}` } })).response.status, 400)
const reopenedTask = await request(`/api/tasks/${createdTask.body.task.id}`, {
  method: 'PATCH', headers: { authorization: `Bearer ${registration.body.accessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ completed: false }),
})
assert.equal(reopenedTask.body.task.completedAt, null)

const secondUser = {
  displayName: 'Other User',
  email: `auth-${randomUUID()}@example.com`,
  password: 'localtest456',
}
const secondRegistration = await request('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(secondUser),
})
const isolatedTasks = await request('/api/tasks', {
  headers: { authorization: `Bearer ${secondRegistration.body.accessToken}` },
})
assert.equal(isolatedTasks.body.tasks.length, 0)
const isolatedAnalytics = await request(`/api/analytics?startDate=2026-01-01&endDate=${today}&timezone=UTC`, {
  headers: { authorization: `Bearer ${secondRegistration.body.accessToken}` },
})
assert.equal(isolatedAnalytics.body.totals.created, 0)
assert.equal(isolatedAnalytics.body.totals.completed, 0)

const firstAuth = { authorization: `Bearer ${registration.body.accessToken}`, 'content-type': 'application/json' }
const secondAuth = { authorization: `Bearer ${secondRegistration.body.accessToken}`, 'content-type': 'application/json' }
assert.equal((await request('/api/habits')).response.status, 401)
const habitDraft = {
  name: 'API walking habit', description: 'Daily walk', category: 'Sức khỏe', icon: 'heart', color: '#55836b',
  frequency: 'daily', weeklyTarget: 7, startDate: '2020-01-01', endDate: null,
}
const createdHabit = await request('/api/habits', { method: 'POST', headers: firstAuth, body: JSON.stringify(habitDraft) })
assert.equal(createdHabit.response.status, 201)
assert.equal(createdHabit.body.habit.frequency, 'daily')
const habitId = createdHabit.body.habit.id
const isolatedHabits = await request('/api/habits', { headers: secondAuth })
assert.equal(isolatedHabits.body.habits.length, 0)
assert.equal((await request(`/api/habits/${habitId}`, { headers: secondAuth })).response.status, 404)
const todayDate = new Date().toISOString().slice(0, 10)
const yesterdayDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
assert.equal((await request(`/api/habits/${habitId}/completions/2099-01-01`, { method: 'PUT', headers: firstAuth })).response.status, 400)
assert.equal((await request(`/api/habits/${habitId}/completions/2026-02-30`, { method: 'PUT', headers: firstAuth })).response.status, 400)
assert.equal((await request(`/api/habits/${habitId}/completions/${todayDate}`, { method: 'PUT', headers: secondAuth })).response.status, 404)
const historicalCompletion = await request(`/api/habits/${habitId}/completions/${yesterdayDate}`, { method: 'PUT', headers: firstAuth })
assert.equal(historicalCompletion.response.status, 200)
assert.equal(historicalCompletion.body.duplicate, false)
const duplicateCompletion = await request(`/api/habits/${habitId}/completions/${yesterdayDate}`, { method: 'PUT', headers: firstAuth })
assert.equal(duplicateCompletion.response.status, 200)
assert.equal(duplicateCompletion.body.duplicate, true)
const todayCompletion = await request(`/api/habits/${habitId}/completions/${todayDate}`, { method: 'PUT', headers: firstAuth })
assert.equal(todayCompletion.body.completion.date, todayDate)
const habitHistory = await request(`/api/habits/${habitId}/completions?startDate=${yesterdayDate}&endDate=${todayDate}&timezone=UTC`, { headers: firstAuth })
assert.deepEqual(habitHistory.body.completions, [yesterdayDate, todayDate])
const habitHeatmap = await request(`/api/habit-analytics/history?startDate=${yesterdayDate}&endDate=${todayDate}&timezone=UTC`, { headers: firstAuth })
assert.equal(habitHeatmap.body.days.length, 2)
assert.ok(habitHeatmap.body.days.every((day) => day.eligibleDaily === 1 && day.missedDaily === 0))
const habitSummary = await request('/api/habit-analytics/summary?timezone=UTC', { headers: firstAuth })
assert.equal(habitSummary.response.status, 200)
assert.equal(habitSummary.body.habits.find((habit) => habit.id === habitId).currentStreak, 2)
assert.equal((await request('/api/habit-analytics/summary?timezone=Invalid/Zone', { headers: firstAuth })).response.status, 400)
const editedHabit = await request(`/api/habits/${habitId}`, { method: 'PATCH', headers: firstAuth, body: JSON.stringify({ name: 'Edited walking habit' }) })
assert.equal(editedHabit.body.habit.name, 'Edited walking habit')
const createdWeeklyHabit = await request('/api/habits', {
  method: 'POST', headers: firstAuth,
  body: JSON.stringify({ ...habitDraft, name: 'Weekly reading', category: 'Học tập', frequency: 'weekly', weeklyTarget: 3 }),
})
assert.equal(createdWeeklyHabit.response.status, 201)
assert.equal((await request(`/api/habits/${createdWeeklyHabit.body.habit.id}`, { method: 'PATCH', headers: firstAuth, body: JSON.stringify({ frequency: 'daily', weeklyTarget: 3 }) })).response.status, 400)
const archivedHabit = await request(`/api/habits/${habitId}/archive`, { method: 'POST', headers: firstAuth })
assert.equal(archivedHabit.body.habit.archived, true)
const activeHabits = await request('/api/habits?archived=false', { headers: firstAuth })
assert.equal(activeHabits.body.habits.some((habit) => habit.id === habitId), false)
const archivedHabits = await request('/api/habits?archived=true', { headers: firstAuth })
assert.equal(archivedHabits.body.habits.some((habit) => habit.id === habitId), true)
const unarchivedHabit = await request(`/api/habits/${habitId}`, { method: 'PATCH', headers: firstAuth, body: JSON.stringify({ archived: false }) })
assert.equal(unarchivedHabit.body.habit.archived, false)
assert.equal((await request(`/api/habits/${habitId}/completions/${yesterdayDate}`, { method: 'DELETE', headers: firstAuth })).response.status, 204)
assert.equal((await request(`/api/habits/${habitId}/completions/${yesterdayDate}`, { method: 'DELETE', headers: firstAuth })).response.status, 404)
assert.equal((await request(`/api/habits/${createdWeeklyHabit.body.habit.id}`, { method: 'DELETE', headers: firstAuth })).response.status, 204)
assert.equal((await request(`/api/habits/${habitId}`, { method: 'DELETE', headers: firstAuth })).response.status, 204)
const createdProject = await request('/api/projects', {
  method: 'POST',
  headers: firstAuth,
  body: JSON.stringify({ name: 'API Project', description: 'Project test', color: '#55836b' }),
})
assert.equal(createdProject.response.status, 201)
assert.equal(createdProject.body.project.progress, 0)
const editedProject = await request(`/api/projects/${createdProject.body.project.id}`, {
  method: 'PATCH', headers: firstAuth, body: JSON.stringify({ description: 'Updated project details', archived: true }),
})
assert.equal(editedProject.body.project.description, 'Updated project details')
assert.equal(editedProject.body.project.archived, true)
const activeProjects = await request('/api/projects', { headers: firstAuth })
assert.equal(activeProjects.body.projects.find((project) => project.id === createdProject.body.project.id).archived, true)
await request(`/api/projects/${createdProject.body.project.id}`, { method: 'PATCH', headers: firstAuth, body: JSON.stringify({ archived: false }) })

const projectTask = await request('/api/tasks', {
  method: 'POST',
  headers: firstAuth,
  body: JSON.stringify({ title: 'Project task', category: 'Công việc', priority: 'high', dueDate: '2020-01-01', projectId: createdProject.body.project.id }),
})
assert.equal(projectTask.response.status, 201)
assert.equal(projectTask.body.task.projectId, createdProject.body.project.id)
const startedFocus = await request('/api/focus-sessions', {
  method: 'POST', headers: firstAuth,
  body: JSON.stringify({ durationSeconds: 60, taskId: projectTask.body.task.id }),
})
assert.equal(startedFocus.response.status, 201)
assert.equal(startedFocus.body.session.projectId, createdProject.body.project.id)
assert.equal(startedFocus.body.session.status, 'running')
const restoredFocus = await request('/api/focus-sessions/active', { headers: firstAuth })
assert.equal(restoredFocus.body.session.id, startedFocus.body.session.id)
assert.ok(restoredFocus.body.session.activeSegmentStartedAt)
assert.equal((await request('/api/focus-sessions/active', { headers: secondAuth })).body.session, null)
assert.equal((await request('/api/focus-sessions', { method: 'POST', headers: firstAuth, body: JSON.stringify({ durationSeconds: 60 }) })).response.status, 409)
assert.equal((await request(`/api/focus-sessions/${startedFocus.body.session.id}/pause`, { method: 'POST', headers: secondAuth })).response.status, 404)
const pausedFocus = await request(`/api/focus-sessions/${startedFocus.body.session.id}/pause`, { method: 'POST', headers: firstAuth })
assert.equal(pausedFocus.body.session.status, 'paused')
const resumedFocus = await request(`/api/focus-sessions/${startedFocus.body.session.id}/resume`, { method: 'POST', headers: firstAuth })
assert.equal(resumedFocus.body.session.status, 'running')
assert.equal((await request(`/api/focus-sessions/${startedFocus.body.session.id}/complete`, { method: 'POST', headers: firstAuth })).response.status, 409)
const interruptedFocus = await request(`/api/focus-sessions/${startedFocus.body.session.id}/interrupt`, { method: 'POST', headers: firstAuth })
assert.equal(interruptedFocus.body.session.status, 'interrupted')
const duplicateInterrupt = await request(`/api/focus-sessions/${startedFocus.body.session.id}/interrupt`, { method: 'POST', headers: firstAuth })
assert.equal(duplicateInterrupt.response.status, 200)
assert.equal(duplicateInterrupt.body.duplicate, true)
const invalidAssignment = await request('/api/tasks', {
  method: 'POST',
  headers: secondAuth,
  body: JSON.stringify({ title: 'Cross-owner assignment', category: 'Công việc', priority: 'low', projectId: createdProject.body.project.id }),
})
assert.equal(invalidAssignment.response.status, 404)

const createdSubtask = await request(`/api/tasks/${projectTask.body.task.id}/subtasks`, {
  method: 'POST', headers: firstAuth, body: JSON.stringify({ title: 'First step' }),
})
assert.equal(createdSubtask.response.status, 201)
const secondSubtask = await request(`/api/tasks/${projectTask.body.task.id}/subtasks`, {
  method: 'POST', headers: firstAuth, body: JSON.stringify({ title: 'Second step' }),
})
assert.equal(secondSubtask.body.subtask.position, 1)
const blankSubtask = await request(`/api/tasks/${projectTask.body.task.id}/subtasks`, {
  method: 'POST', headers: firstAuth, body: JSON.stringify({ title: '  ' }),
})
assert.equal(blankSubtask.response.status, 400)
const crossUserSubtasks = await request(`/api/tasks/${projectTask.body.task.id}/subtasks`, { headers: secondAuth })
assert.equal(crossUserSubtasks.response.status, 404)
const completedSubtask = await request(`/api/tasks/${projectTask.body.task.id}/subtasks/${createdSubtask.body.subtask.id}`, {
  method: 'PATCH', headers: firstAuth, body: JSON.stringify({ title: 'Renamed step', completed: true, position: 1 }),
})
assert.equal(completedSubtask.body.subtask.completed, true)
assert.equal(completedSubtask.body.subtask.title, 'Renamed step')
const orderedSubtasks = await request(`/api/tasks/${projectTask.body.task.id}/subtasks`, { headers: firstAuth })
assert.equal(orderedSubtasks.body.subtasks[0].id, secondSubtask.body.subtask.id)
const filteredTasks = await request(`/api/tasks?projectId=${createdProject.body.project.id}`, { headers: firstAuth })
assert.equal(filteredTasks.body.tasks.length, 1)
const projectDetail = await request(`/api/projects/${createdProject.body.project.id}`, { headers: firstAuth })
assert.equal(projectDetail.body.project.totalTasks, 1)
assert.equal(projectDetail.body.project.overdueTasks, 1)
assert.equal(projectDetail.body.project.progress, 0)
const completedProjectTask = await request(`/api/tasks/${projectTask.body.task.id}`, {
  method: 'PATCH', headers: firstAuth, body: JSON.stringify({ completed: true }),
})
assert.equal(completedProjectTask.body.task.subtaskCompleted, 1)
const completedProjectDetail = await request(`/api/projects/${createdProject.body.project.id}`, { headers: firstAuth })
assert.equal(completedProjectDetail.body.project.progress, 100)
const removedSubtask = await request(`/api/tasks/${projectTask.body.task.id}/subtasks/${createdSubtask.body.subtask.id}`, {
  method: 'DELETE', headers: firstAuth,
})
assert.equal(removedSubtask.response.status, 204)
const hiddenProject = await request(`/api/projects/${createdProject.body.project.id}`, { headers: secondAuth })
assert.equal(hiddenProject.response.status, 404)
const unassignedDelete = await request(`/api/projects/${createdProject.body.project.id}`, {
  method: 'DELETE', headers: firstAuth, body: JSON.stringify({ taskBehavior: 'unassign' }),
})
assert.equal(unassignedDelete.response.status, 204)
const preservedTasks = await request('/api/tasks?projectId=unassigned', { headers: firstAuth })
const preservedTask = preservedTasks.body.tasks.find((task) => task.id === projectTask.body.task.id)
assert.ok(preservedTask)
assert.equal(preservedTask.projectId, null)
const templates = await request('/api/project-templates', { headers: firstAuth })
assert.equal(templates.body.templates.length, 3)
const templatedProject = await request('/api/projects/from-template', {
  method: 'POST', headers: firstAuth, body: JSON.stringify({ templateId: 'study', name: 'Custom Study Plan' }),
})
assert.equal(templatedProject.response.status, 201)
const templatedDetail = await request(`/api/projects/${templatedProject.body.project.id}`, { headers: firstAuth })
assert.equal(templatedDetail.body.project.name, 'Custom Study Plan')
assert.equal(templatedDetail.body.project.totalTasks, 4)
const invalidProjectDelete = await request(`/api/projects/${templatedProject.body.project.id}`, { method: 'DELETE', headers: firstAuth, body: JSON.stringify({}) })
assert.equal(invalidProjectDelete.response.status, 400)
const deletedProject = await request(`/api/projects/${templatedProject.body.project.id}`, { method: 'DELETE', headers: firstAuth, body: JSON.stringify({ taskBehavior: 'delete' }) })
assert.equal(deletedProject.response.status, 204)

const rotation = await request('/api/auth/refresh', {
  method: 'POST',
  headers: { cookie: firstRefreshCookie },
})
assert.equal(rotation.response.status, 200)
const rotatedCookie = cookieFrom(rotation.response)

const replay = await request('/api/auth/refresh', {
  method: 'POST',
  headers: { cookie: firstRefreshCookie },
})
assert.equal(replay.response.status, 401)
const revokedFamily = await request('/api/auth/refresh', {
  method: 'POST',
  headers: { cookie: rotatedCookie },
})
assert.equal(revokedFamily.response.status, 401)

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: firstUser.email, password: firstUser.password }),
})
assert.equal(login.response.status, 200)
const loginCookie = cookieFrom(login.response)
const logout = await request('/api/auth/logout', {
  method: 'POST',
  headers: { cookie: loginCookie },
})
assert.equal(logout.response.status, 204)
const afterLogout = await request('/api/auth/refresh', {
  method: 'POST',
  headers: { cookie: loginCookie },
})
assert.equal(afterLogout.response.status, 401)

console.log('API integration passed: habit CRUD, duplicate and historical completions, streaks, auth ownership, analytics, focus sessions, projects, subtasks, refresh rotation, and logout.')