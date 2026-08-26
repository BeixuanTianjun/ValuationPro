// Account handling for the local service.
//
// The first account created becomes the administrator, and the administrator's
// email is where the daily stock-pick digest is sent — that is the whole point
// of having accounts here, so the alert recipient is a property of the person
// who owns the install rather than a value buried in a config file.
//
// SECURITY POSTURE, STATED PLAINLY:
//   - Passwords are never stored. Only a scrypt hash and a per-user random salt
//     go to disk, and comparison is constant-time.
//   - Session tokens are 32 random bytes, delivered as an httpOnly cookie so
//     page scripts cannot read them.
//   - Login attempts are rate limited per email to blunt guessing.
//   - This service speaks HTTP on localhost. Over the loopback interface that
//     is fine; if you ever bind it to a LAN or the internet, credentials would
//     travel in cleartext and you would need TLS in front of it first.
//   - The static files under /data are served without a session check. They are
//     public IDX market data, not private information.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export type Role = 'administrator' | 'anggota';

export interface UserRecord {
  email: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PublicUser {
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
}

interface Store {
  users: UserRecord[];
}

const publicView = (u: UserRecord): PublicUser => ({
  email: u.email,
  name: u.name,
  role: u.role,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

let storePath = '';
let cache: Store | null = null;

export function configureAuth(dataDir: string): void {
  storePath = join(dataDir, 'users.json');
}

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(storePath, 'utf8')) as Store;
  } catch {
    cache = { users: [] };
  }
  return cache;
}

async function persist(store: Store): Promise<void> {
  cache = store;
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
}

const normaliseEmail = (email: string) => email.trim().toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface Validation {
  ok: boolean;
  error?: string;
}

/**
 * Password rules kept to what actually matters: length does far more work than
 * character-class rules, which mostly push people toward "Password1!".
 */
export function validateCredentials(email: string, password: string, name: string): Validation {
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Format email tidak valid.' };
  if (!name.trim()) return { ok: false, error: 'Nama tidak boleh kosong.' };
  if (password.length < 10) return { ok: false, error: 'Kata sandi minimal 10 karakter.' };
  if (password.length > 200) return { ok: false, error: 'Kata sandi terlalu panjang.' };
  if (/^\d+$/.test(password)) return { ok: false, error: 'Kata sandi tidak boleh hanya angka.' };
  if (password.toLowerCase().includes(email.split('@')[0].toLowerCase())) {
    return { ok: false, error: 'Kata sandi tidak boleh memuat bagian dari alamat email Anda.' };
  }
  return { ok: true };
}

async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return { salt, hash: derived.toString('hex') };
}

async function passwordMatches(password: string, user: UserRecord): Promise<boolean> {
  const derived = await scrypt(password, user.salt, KEY_LENGTH);
  const stored = Buffer.from(user.hash, 'hex');
  // Lengths must match before timingSafeEqual, which throws otherwise.
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(stored, derived);
}

// ------------------------------------------------------------------ sessions

interface Session {
  email: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function issueSession(email: string): string {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function revokeSession(token: string | null): void {
  if (token) sessions.delete(token);
}

export async function userForToken(token: string | null): Promise<PublicUser | null> {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const store = await load();
  const user = store.users.find((u) => u.email === session.email);
  return user ? publicView(user) : null;
}

// -------------------------------------------------------------- rate limiting

const attempts = new Map<string, { count: number; firstAt: number }>();

function tooManyAttempts(email: string): boolean {
  const entry = attempts.get(email);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.delete(email);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(email: string): void {
  const entry = attempts.get(email);
  if (!entry || Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(email, { count: 1, firstAt: Date.now() });
  } else {
    entry.count++;
  }
}

// ------------------------------------------------------------------- actions

export interface AuthResult {
  ok: boolean;
  status: number;
  error?: string;
  user?: PublicUser;
  token?: string;
}

export async function signUp(email: string, password: string, name: string): Promise<AuthResult> {
  const normalised = normaliseEmail(email);
  const check = validateCredentials(normalised, password, name);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  const store = await load();
  if (store.users.some((u) => u.email === normalised)) {
    return { ok: false, status: 409, error: 'Email itu sudah terdaftar. Silakan masuk.' };
  }

  const { salt, hash } = await hashPassword(password);
  // First account owns the install, and therefore owns the alert inbox.
  const role: Role = store.users.length === 0 ? 'administrator' : 'anggota';

  const user: UserRecord = {
    email: normalised,
    name: name.trim(),
    role,
    salt,
    hash,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  store.users.push(user);
  await persist(store);

  return { ok: true, status: 201, user: publicView(user), token: issueSession(normalised) };
}

export async function logIn(email: string, password: string): Promise<AuthResult> {
  const normalised = normaliseEmail(email);

  if (tooManyAttempts(normalised)) {
    return { ok: false, status: 429, error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' };
  }

  const store = await load();
  const user = store.users.find((u) => u.email === normalised);

  // Same message and roughly the same work whether the email exists or not, so
  // the response cannot be used to enumerate registered addresses.
  if (!user) {
    await hashPassword(password);
    recordFailure(normalised);
    return { ok: false, status: 401, error: 'Email atau kata sandi salah.' };
  }

  if (!(await passwordMatches(password, user))) {
    recordFailure(normalised);
    return { ok: false, status: 401, error: 'Email atau kata sandi salah.' };
  }

  attempts.delete(normalised);
  user.lastLoginAt = new Date().toISOString();
  await persist(store);

  return { ok: true, status: 200, user: publicView(user), token: issueSession(normalised) };
}

export async function listUsers(): Promise<PublicUser[]> {
  return (await load()).users.map(publicView);
}

export async function administrator(): Promise<PublicUser | null> {
  const store = await load();
  const admin = store.users.find((u) => u.role === 'administrator');
  return admin ? publicView(admin) : null;
}

export async function hasAnyUser(): Promise<boolean> {
  return (await load()).users.length > 0;
}

// -------------------------------------------------------------------- cookies

export const SESSION_COOKIE = 'vp_session';

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

export function sessionCookie(token: string): string {
  // Not `Secure`: this service is plain HTTP on localhost, and setting Secure
  // would stop the cookie from being stored at all. Put TLS in front before
  // exposing it anywhere else.
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export const clearedCookie = () => `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
