import { cookies } from 'next/headers';
import { SESSION_COOKIE, newSession, safeEqual } from '@/lib/auth';

export async function POST(req) {
  const pw = process.env.TEAM_PASSWORD;
  if (!pw) return Response.json({ error: 'TEAM_PASSWORD is not set on the server' }, { status: 500 });
  const { password } = await req.json().catch(() => ({}));
  if (!password || !safeEqual(password, pw)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return Response.json({ error: 'Wrong password' }, { status: 401 });
  }
  const s = newSession();
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: s.maxAge,
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
