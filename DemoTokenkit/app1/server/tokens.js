import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { db } from './database.js'

const isProduction = process.env.NODE_ENV === 'production'
const accessSecret = process.env.JWT_ACCESS_SECRET ?? (isProduction ? '' : 'local-development-access-secret-change-me')
const refreshSecret = process.env.JWT_REFRESH_SECRET ?? (isProduction ? '' : 'local-development-refresh-secret-change-me')

if (accessSecret.length < 32 || refreshSecret.length < 32 || accessSecret === refreshSecret) {
  throw new Error('Set distinct JWT_ACCESS_SECRET and JWT_REFRESH_SECRET values of at least 32 characters.')
}

const issuer = 'viec-nho-api'
const refreshLifetimeSeconds = 7 * 24 * 60 * 60
const refreshLifetimeMs = refreshLifetimeSeconds * 1000

function digest(token) {
  return createHash('sha256').update(token).digest('hex')
}

function secureHashMatch(first, second) {
  const firstHash = Buffer.from(digest(first), 'hex')
  const secondHash = Buffer.from(second, 'hex')
  return timingSafeEqual(firstHash, secondHash)
}

function signAccessToken(user) {
  return jwt.sign({ email: user.email, type: 'access' }, accessSecret, {
    subject: user.id,
    issuer,
    audience: 'viec-nho-web',
    expiresIn: '10m',
  })
}

function issueRefreshToken(userId, familyId) {
  const jti = randomUUID()
  const expiresAt = Date.now() + refreshLifetimeMs
  const token = jwt.sign({ type: 'refresh', familyId }, refreshSecret, {
    subject: userId,
    jwtid: jti,
    issuer,
    audience: 'viec-nho-web',
    expiresIn: refreshLifetimeSeconds,
  })
  db.prepare('INSERT INTO refresh_sessions (jti, family_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(jti, familyId, userId, digest(token), expiresAt)
  return token
}

export function createTokenPair(user) {
  const familyId = randomUUID()
  return { accessToken: signAccessToken(user), refreshToken: issueRefreshToken(user.id, familyId) }
}

export function rotateRefreshToken(token) {
  let claims
  try {
    claims = jwt.verify(token, refreshSecret, { issuer, audience: 'viec-nho-web' })
  } catch {
    return null
  }

  if (typeof claims === 'string' || claims.type !== 'refresh' || !claims.sub || !claims.jti || !claims.familyId) return null

  const session = db.prepare('SELECT * FROM refresh_sessions WHERE jti = ? AND user_id = ?').get(claims.jti, claims.sub)
  if (!session || !secureHashMatch(token, session.token_hash)) return null

  if (session.revoked_at) {
    db.prepare('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?').run(Date.now(), session.family_id)
    return null
  }

  if (session.expires_at <= Date.now()) return null

  const user = db.prepare('SELECT id, email, display_name AS displayName FROM users WHERE id = ?').get(session.user_id)
  if (!user) return null

  const nextJti = randomUUID()
  const nextToken = jwt.sign({ type: 'refresh', familyId: session.family_id }, refreshSecret, {
    subject: user.id,
    jwtid: nextJti,
    issuer,
    audience: 'viec-nho-web',
    expiresIn: refreshLifetimeSeconds,
  })
  const transaction = db.transaction(() => {
    db.prepare('UPDATE refresh_sessions SET revoked_at = ?, replaced_by = ? WHERE jti = ? AND revoked_at IS NULL')
      .run(Date.now(), nextJti, session.jti)
    db.prepare('INSERT INTO refresh_sessions (jti, family_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(nextJti, session.family_id, user.id, digest(nextToken), Date.now() + refreshLifetimeMs)
  })
  transaction()

  return { user, accessToken: signAccessToken(user), refreshToken: nextToken }
}

export function revokeRefreshToken(token) {
  try {
    const claims = jwt.verify(token, refreshSecret, { issuer, audience: 'viec-nho-web', ignoreExpiration: true })
    if (typeof claims !== 'string' && claims.type === 'refresh' && claims.jti) {
      db.prepare('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?')
        .run(Date.now(), claims.familyId)
    }
  } catch {
    return
  }
}

export function verifyAccessToken(token) {
  const claims = jwt.verify(token, accessSecret, { issuer, audience: 'viec-nho-web' })
  if (typeof claims === 'string' || claims.type !== 'access' || !claims.sub) throw new Error('Invalid access token')
  return { id: claims.sub, email: claims.email }
}

export const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: refreshLifetimeMs,
}

export const clearRefreshCookieOptions = { ...refreshCookieOptions, maxAge: undefined }