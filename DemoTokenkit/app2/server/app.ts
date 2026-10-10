import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';

const refreshCookie = 'refreshToken';
const refreshLifetimeSeconds = 7 * 24 * 60 * 60;

interface User {
  id: string;
  email: string;
}

interface AuthOptions {
  database: Database.Database;
  accessSecret: string;
  refreshSecret: string;
  secureCookies?: boolean;
}

interface AccessRequest extends Request {
  user?: User;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueAccessToken(user: User, secret: string): string {
  return jwt.sign({ type: 'access', email: user.email }, secret, { subject: user.id, expiresIn: '15m' });
}

function setRefreshCookie(response: Response, token: string, secure: boolean): void {
  response.cookie(refreshCookie, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: refreshLifetimeSeconds * 1000,
  });
}

export function createApp(options: AuthOptions) {
  const { database, accessSecret, refreshSecret, secureCookies = false } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Có quá nhiều lần thử. Vui lòng đợi 15 phút.' },
  });

  function createSession(response: Response, user: User): string {
    const tokenId = randomUUID();
    const token = jwt.sign({ type: 'refresh' }, refreshSecret, {
      subject: user.id,
      jwtid: tokenId,
      expiresIn: refreshLifetimeSeconds,
    });
    database.prepare('INSERT INTO refresh_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), user.id, Date.now() + refreshLifetimeSeconds * 1000, new Date().toISOString());
    setRefreshCookie(response, token, secureCookies);
    return issueAccessToken(user, accessSecret);
  }

  function authenticate(request: AccessRequest, response: Response, next: NextFunction): void {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) {
      response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
      return;
    }
    try {
      const payload = jwt.verify(token, accessSecret) as JwtPayload;
      if (payload.type !== 'access' || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
        return;
      }
      request.user = { id: payload.sub, email: payload.email };
      next();
    } catch {
      response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
    }
  }

  app.post('/api/auth/register', credentialLimiter, async (request, response, next) => {
    try {
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response.status(400).json({ error: 'Vui lòng nhập email hợp lệ.' });
        return;
      }
      if (password.length < 10 || password.length > 128) {
        response.status(400).json({ error: 'Mật khẩu cần có từ 10 đến 128 ký tự.' });
        return;
      }
      const user: User = { id: randomUUID(), email };
      try {
        database.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
          .run(user.id, user.email, await bcrypt.hash(password, 12), new Date().toISOString());
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          response.status(409).json({ error: 'Địa chỉ email này đã được đăng ký.' });
          return;
        }
        throw error;
      }
      response.status(201).json({ accessToken: createSession(response, user), user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', credentialLimiter, async (request, response, next) => {
    try {
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const row = database.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email) as
        { id: string; email: string; password_hash: string } | undefined;
      if (!row || !(await bcrypt.compare(password, row.password_hash))) {
        response.status(401).json({ error: 'Email hoặc mật khẩu chưa chính xác.' });
        return;
      }
      const user: User = { id: row.id, email: row.email };
      response.json({ accessToken: createSession(response, user), user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/refresh', (request, response) => {
    const token = request.cookies?.[refreshCookie] as string | undefined;
    if (!token) {
      response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
      return;
    }
    try {
      const payload = jwt.verify(token, refreshSecret) as JwtPayload;
      const tokenHash = hashToken(token);
      const row = database.prepare(`SELECT users.id, users.email FROM refresh_sessions
        INNER JOIN users ON users.id = refresh_sessions.user_id
        WHERE refresh_sessions.token_hash = ? AND refresh_sessions.expires_at > ?`)
        .get(tokenHash, Date.now()) as User | undefined;
      if (payload.type !== 'refresh' || typeof payload.sub !== 'string' || row?.id !== payload.sub) {
        response.clearCookie(refreshCookie, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/auth' });
        response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
        return;
      }
      const rotate = database.transaction(() => {
        const removed = database.prepare('DELETE FROM refresh_sessions WHERE token_hash = ?').run(tokenHash);
        if (removed.changes !== 1) return null;
        return createSession(response, row);
      });
      const accessToken = rotate();
      if (!accessToken) {
        response.status(401).json({ error: 'Phiên đăng nhập đã được sử dụng.' });
        return;
      }
      response.json({ accessToken, user: row });
    } catch {
      response.clearCookie(refreshCookie, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/auth' });
      response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
    }
  });

  app.post('/api/auth/logout', (request, response) => {
    const token = request.cookies?.[refreshCookie] as string | undefined;
    if (token) database.prepare('DELETE FROM refresh_sessions WHERE token_hash = ?').run(hashToken(token));
    response.clearCookie(refreshCookie, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/auth' });
    response.status(204).end();
  });

  app.get('/api/auth/me', authenticate, (request: AccessRequest, response) => {
    response.json({ user: request.user });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    console.error(error);
    response.status(500).json({ error: 'Đã có lỗi xảy ra. Vui lòng thử lại.' });
  });

  return app;
}