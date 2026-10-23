// Team login (one shared password, signed cookie) and runner authentication (bearer token).
import crypto from 'crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'bt_session';
const SESSION_DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');

// Compare via hashes so different lengths do not leak through timing.
export function safeEqual(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

export function newSession() {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return { value: `${exp}.${sign(exp)}`, maxAge: SESSION_DAYS * 86400 };
}

function validSession(v) {
  const [exp, mac] = String(v || '').split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  return safeEqual(mac, sign(exp));
}

export async function isLoggedIn() {
  return validSession((await cookies()).get(SESSION_COOKIE)?.value);
}

const deny = (msg) => Response.json({ error: msg }, { status: 401 });
const fail = (e) => Response.json({ error: String(e.message || e) }, { status: 500 });

// Wrap a route handler so only logged-in team members reach it.
export function team(handler) {
  return async (req, ctx) => {
    try {
      if (!(await isLoggedIn())) return deny('Not logged in');
      return await handler(req, ctx);
    } catch (e) { return fail(e); }
  };
}

// Wrap a route handler so only runners holding RUNNER_TOKEN reach it.
export function runner(handler) {
  return async (req, ctx) => {
    try {
      const t = process.env.RUNNER_TOKEN;
      if (!t || !safeEqual(req.headers.get('authorization') || '', 'Bearer ' + t)) return deny('Bad runner token');
      return await handler(req, ctx);
    } catch (e) { return fail(e); }
  };
}
