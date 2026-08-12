'use client';

/**
 * Thin fetch wrapper for the Express API.
 *
 * The JWT lives in localStorage: acceptable for a demonstration platform, and
 * called out as such in docs/architecture.md. A production deployment would
 * move it to an httpOnly cookie so a script injection cannot read it.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'iqsms.token';
const USER_KEY = 'iqsms.user';

export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  role: 'FIELD_REPORTER' | 'QHSSE_AUDITOR' | 'DEPARTMENT_LEAD' | 'SYSTEM_ADMIN';
  department: string | null;
  zoneId: number | null;
  zoneName: string | null;
  scopeLabel: string;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function storeSession(token: string, user: SessionUser) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    // An expired or revoked token should drop the user at the login screen
    // rather than leaving them staring at a page of failed panels.
    if (response.status === 401 && typeof window !== 'undefined') {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    throw new ApiError(response.status, body?.error ?? `Request failed (${response.status})`, body?.details);
  }

  return body as T;
}

export async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, body?.error ?? 'Login failed');
  storeSession(body.token, body.user);
  return body.user as SessionUser;
}
