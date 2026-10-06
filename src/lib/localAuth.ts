// Offline demo mode accounts. Passwords are salted and hashed with PBKDF2
// (WebCrypto), and everything stays in this browser's IndexedDB.

import { db, type LocalUser } from './data/localdb';
import { nowISO, uuid } from './id';

const SESSION_KEY = 'doctrace.session';

export interface LocalSession {
  userId: string;
  email: string;
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120000 }, key, 256);
  return hex(bits);
}

export function validatePassword(p: string): string | null {
  if (p.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use letters and at least one number.';
  return null;
}

export async function localSignUp(email: string, password: string): Promise<LocalSession> {
  const e = email.trim().toLowerCase();
  const d = await db();
  if (await d.getFromIndex('users', 'email', e)) throw new Error('An account with this email already exists. Sign in instead.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const user: LocalUser = { id: uuid(), email: e, salt, hash: await hashPassword(password, salt), created_at: nowISO() };
  await d.add('users', user);
  return startSession({ userId: user.id, email: e });
}

export async function localSignIn(email: string, password: string): Promise<LocalSession> {
  const e = email.trim().toLowerCase();
  const user = await (await db()).getFromIndex('users', 'email', e);
  if (!user || (await hashPassword(password, user.salt)) !== user.hash) throw new Error('Wrong email or password.');
  return startSession({ userId: user.id, email: e });
}

function startSession(s: LocalSession): LocalSession {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Private browsing: the session simply won't survive a reload.
  }
  return s;
}

export function currentLocalSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as LocalSession) : null;
    return s?.userId && s.email ? s : null;
  } catch {
    return null;
  }
}

export function localSignOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
