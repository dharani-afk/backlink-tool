import { q } from '@/lib/db';
import { runner } from '@/lib/auth';
import { MAX_UPLOAD } from '@/lib/util';

export const POST = runner(async (req, { params }) => {
  const { id } = await params;
  const img = Buffer.from(await req.arrayBuffer());
  if (img.length > MAX_UPLOAD) return Response.json({ error: 'Screenshot too large' }, { status: 413 });
  await q(`insert into shots (job_id, img) values ($1, $2) on conflict (job_id) do update set img = excluded.img`, [id, img]);
  await q('update jobs set has_shot = true where id = $1', [id]);
  return Response.json({ ok: true });
});
