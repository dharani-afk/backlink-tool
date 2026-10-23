import { q } from '@/lib/db';
import { team } from '@/lib/auth';

export const GET = team(async (req, { params }) => {
  const { id, name } = await params;
  const [d] = await q('select content from docs where client_id = $1 and name = $2', [id, name]);
  if (!d) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(d.content), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});

export const DELETE = team(async (req, { params }) => {
  const { id, name } = await params;
  await q('delete from docs where client_id = $1 and name = $2', [id, name]);
  return Response.json({ ok: true });
});
