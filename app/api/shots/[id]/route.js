import { q } from '@/lib/db';
import { team } from '@/lib/auth';

export const GET = team(async (req, { params }) => {
  const { id } = await params;
  const [s] = await q('select img from shots where job_id = $1', [id]);
  if (!s) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(s.img), { headers: { 'Content-Type': 'image/jpeg' } });
});
