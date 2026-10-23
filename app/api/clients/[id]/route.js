import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { CLIENT_FIELDS } from '@/lib/util';

export const PUT = team(async (req, { params }) => {
  const { id } = await params;
  const body = await req.json();
  const [row] = await q('select data from clients where id = $1', [id]);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  const c = row.data;
  for (const f of CLIENT_FIELDS) if (f in body) c[f] = (body[f] || '').toString();
  if (!c.name || !c.url) return Response.json({ error: 'name and url are required' }, { status: 400 });
  await q('update clients set data = $2::text::jsonb where id = $1', [id, JSON.stringify(c)]);
  return Response.json({ ...c, id });
});

export const DELETE = team(async (req, { params }) => {
  const { id } = await params;
  await q('delete from accounts where client_id = $1', [id]);
  await q('delete from clients where id = $1', [id]);
  return Response.json({ ok: true });
});
