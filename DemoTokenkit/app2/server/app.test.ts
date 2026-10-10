// @vitest-environment node
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createDatabase } from './database';

const database = createDatabase(':memory:');
const app = createApp({ database, accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret' });
const agents: ReturnType<typeof request.agent>[] = [];

afterEach(() => {
  for (const agent of agents.splice(0)) void agent;
  database.exec('DELETE FROM refresh_sessions; DELETE FROM users;');
});

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
});