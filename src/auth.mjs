// Accounts and sessions.
//   - Passwords are stored only as salted scrypt hashes.
//   - A session is a random token in an HttpOnly cookie; the server keeps its SHA-256, so a leaked
//     database cannot be replayed as cookies. Sessions last 30 days and can be revoked.
//   - Five wrong passwords lock the account for 15 minutes.
//   - The first administrator comes from ADMIN_EMAIL / ADMIN_PASSWORD; nobody becomes admin by signing up.

import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.mjs';

const scryptAsync = promisify(scrypt);
const COOKIE = 'vs_session';
const SESSION_DAYS = 30;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const signupOpen = () => process.env.ALLOW_SIGNUP !== 'false';
const normEmail = (v) => String(v || '').trim().toLowerCase();
const sha = (v) => createHash('sha256').update(v).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n) || 16384, r: 8, p: 1 });
  return timingSafeEqual(got, want);
}

/** What the browser may know about a user. */
export const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, role: u.role, disabled: Boolean(u.disabled), createdAt: u.ts, lastLoginAt: u.lastLoginAt || null, prefs: u.prefs || {} };

function checkCredentials(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AuthError('Enter a valid email address');
  if (typeof password !== 'string' || password.length < 8) throw new AuthError('The password needs at least 8 characters');
  if (password.length > 200) throw new AuthError('The password is too long');
}

export async function createUser({ email, password, name, role = 'user' }) {
  email = normEmail(email);
  checkCredentials(email, password);
  if (await db.find('users', 'email', email)) throw new AuthError('An account with this email already exists', 409);
  const user = { id: randomUUID().slice(0, 12), ts: Date.now(), email, name: String(name || '').trim().slice(0, 80) || email.split('@')[0], role, passwordHash: await hashPassword(password), prefs: {} };
  try {
    await db.put('users', user);
  } catch (err) {
    if (/vs_users_email|duplicate/i.test(err.message)) throw new AuthError('An account with this email already exists', 409);
    throw err;
  }
  return user;
}

// Verified against even when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY = hashPassword(randomBytes(12).toString('hex'));

/** Returns the user, or throws AuthError. Never says which of email or password was wrong. */
export async function checkLogin(email, password) {
  email = normEmail(email);
  const user = await db.find('users', 'email', email);
  if (user?.lockedUntil > Date.now()) throw new AuthError('Too many attempts. Try again in a few minutes.', 429);
  const ok = await verifyPassword(String(password || ''), user ? user.passwordHash : await DUMMY);
  if (!user || !ok) {
    if (user) {
      await db.update('users', user.id, (u) => {
        u.failed = (u.failed || 0) + 1;
        if (u.failed >= LOCK_AFTER) Object.assign(u, { failed: 0, lockedUntil: Date.now() + LOCK_MS });
      });
    }
    throw new AuthError('Wrong email or password', 401);
  }
  if (user.disabled) throw new AuthError('This account has been disabled. Contact the administrator.', 403);
  return db.update('users', user.id, (u) => Object.assign(u, { failed: 0, lockedUntil: 0, lastLoginAt: Date.now() }));
}

const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || Boolean(process.env.VERCEL);
const cookie = (req, value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

/** Start a session and return the Set-Cookie value. */
export async function startSession(req, user) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.put('sessions', { id: sha(token), userId: user.id, ts: now, expires: now + SESSION_DAYS * 86_400_000 });
  // Housekeeping: drop this user's expired sessions.
  for (const s of await db.list('sessions', { userId: user.id })) if (s.expires < now) await db.del('sessions', s.id);
  return cookie(req, token, SESSION_DAYS * 86_400);
}

const tokenOf = (req) => new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '')?.[1] || '';

/** The signed-in user for this request, or null. */
export async function authenticate(req) {
  const token = tokenOf(req);
  if (!token) return null;
  const session = await db.get('sessions', sha(token));
  if (!session || session.expires < Date.now()) return null;
  const user = await db.get('users', session.userId);
  return user && !user.disabled ? user : null;
}

/** End the session and return the Set-Cookie value that clears the cookie. */
export async function endSession(req) {
  const token = tokenOf(req);
  if (token) await db.del('sessions', sha(token));
  return cookie(req, '', 0);
}

export async function endAllSessions(userId) {
  for (const s of await db.list('sessions', { userId })) await db.del('sessions', s.id);
}

let seeded;
/**
 * Make sure the administrator named by ADMIN_EMAIL / ADMIN_PASSWORD exists. Runs once per process.
 * An existing account is promoted but its password is left alone. Scripts saved before accounts
 * existed are handed to this administrator.
 */
export function ensureAdmin() {
  return (seeded ??= (async () => {
    const email = normEmail(process.env.ADMIN_EMAIL);
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return null;
    let admin = await db.find('users', 'email', email);
    if (!admin) admin = await createUser({ email, password, name: 'Admin', role: 'admin' });
    else if (admin.role !== 'admin') admin = await db.update('users', admin.id, (u) => Object.assign(u, { role: 'admin' }));
    for (const entry of await db.list('history')) if (!entry.userId) await db.update('history', entry.id, (e) => Object.assign(e, { userId: admin.id }));
    return admin;
  })().catch((err) => {
    seeded = undefined;
    console.warn(`[auth] could not set up the administrator: ${err.message}`);
    return null;
  }));
}
