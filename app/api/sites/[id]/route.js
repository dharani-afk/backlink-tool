import { q } from '@/lib/db';
import { team } from '@/lib/auth';

export const DELETE = team(async (req, { params }) => {
  const { id } = await params;
  await q('delete from sites where id = $1', [id]);
  return Response.json({ ok: true });
});
