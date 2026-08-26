// Auth transport. The session lives in an httpOnly cookie, so nothing here
// ever holds a token — `credentials: 'include'` is what carries it.

export type Role = 'administrator' | 'anggota';

export interface AccountUser {
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthState {
  user: AccountUser | null;
  accountsExist: boolean;
  /** False when the local service is not running at all. */
  serviceUp: boolean;
}

const opts: RequestInit = { credentials: 'include', headers: { 'Content-Type': 'application/json' } };

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { ...opts, method: 'POST', body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Gagal (HTTP ${res.status})`);
  return json as T;
}

export async function fetchAuthState(): Promise<AuthState> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/auth/me', { ...opts, signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return { user: null, accountsExist: false, serviceUp: false };
    const body = (await res.json()) as { user: AccountUser | null; accountsExist: boolean };
    return { user: body.user, accountsExist: body.accountsExist, serviceUp: true };
  } catch {
    // No service running: the app still works read-only from the bundled data.
    return { user: null, accountsExist: false, serviceUp: false };
  }
}

export const signUp = (email: string, password: string, name: string) =>
  post<{ user: AccountUser }>('/api/auth/signup', { email, password, name });

export const logIn = (email: string, password: string) =>
  post<{ user: AccountUser }>('/api/auth/login', { email, password });

export const logOut = () => post<{ ok: boolean }>('/api/auth/logout', {});

export async function sendTestAlert(): Promise<string> {
  const res = await fetch('/api/alert/test', { ...opts, method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
  if (!res.ok) throw new Error(body.error || body.detail || `Gagal (HTTP ${res.status})`);
  return body.detail || 'Terkirim.';
}
