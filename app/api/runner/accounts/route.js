import { q } from '@/lib/db';
import { runner } from '@/lib/auth';
import { enc, hostOf } from '@/lib/util';

// A runner created a site account; store it (password encrypted) so any runner can log in next time.
export const POST = runner(async (req) => {
  const { clientId, url, email, username, password } = await req.json();
  if (!clientId || !url || !password) return Response.json({ error: 'clientId, url and password are required' }, { status: 400 });
  await q(`insert into accounts (client_id, host, email, username, password_enc) values ($1, $2, $3, $4, $5)
           on conflict (client_id, host) do update set email = excluded.email, username = excluded.username,
             password_enc = excluded.password_enc, created_at = now()`,
  [clientId, hostOf(url), email || '', username || '', enc(String(password))]);
  return Response.json({ ok: true });
});
