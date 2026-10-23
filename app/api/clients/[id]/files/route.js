import path from 'path';
import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { MAX_UPLOAD } from '@/lib/util';

export const POST = team(async (req, { params }) => {
  const { id } = await params;
  const [c] = await q('select id from clients where id = $1', [id]);
  if (!c) return Response.json({ error: 'not found' }, { status: 404 });
  const name = path.basename(new URL(req.url).searchParams.get('name') || 'file');
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_UPLOAD) return Response.json({ error: 'File is larger than 4 MB' }, { status: 413 });
  await q(`insert into docs (client_id, name, content) values ($1, $2, $3)
           on conflict (client_id, name) do update set content = excluded.content`, [id, name, buf]);
  return Response.json({ ok: true });
});
