import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { id, CLIENT_FIELDS, normalizeClient } from '@/lib/util';

export const GET = team(async () => {
  const rows = await q(`select c.id, c.data,
      coalesce((select array_agg(d.name order by d.name) from docs d where d.client_id = c.id), '{}') as docs
    from clients c order by c.created_at`);
  return Response.json(rows.map((r) => ({ ...r.data, id: r.id, docs: r.docs })));
});

export const POST = team(async (req) => {
  const body = await req.json();
  const c = {};
  for (const f of CLIENT_FIELDS) c[f] = (body[f] || '').toString();
  if (!c.name || !c.url) return Response.json({ error: 'name and url are required' }, { status: 400 });
  const errors = normalizeClient(c);
  if (errors.length) return Response.json({ error: errors.join('. ') }, { status: 400 });
  const cid = id();
  await q('insert into clients (id, data) values ($1, $2::text::jsonb)', [cid, JSON.stringify(c)]);
  return Response.json({ ...c, id: cid, docs: [] });
});
