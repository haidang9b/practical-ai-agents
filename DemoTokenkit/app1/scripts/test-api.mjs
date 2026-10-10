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
  body: JSON.stringify({ title: 'private task', category: 'Công việc', priority: 'high' }),
})
assert.equal(createdTask.response.status, 201)

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

console.log('API integration passed: registration, login, task isolation, refresh rotation, replay revocation, and logout.')