import { q } from '@/lib/db';
import { team } from '@/lib/auth';

// Set or clear the site's listing page by hand (for sites where the runner cannot find it, or found the wrong one).
export const PATCH = team(async (req, { params }) => {
  const { id } = await params;
  let { submitUrl } = await req.json();
  submitUrl = String(submitUrl || '').trim();
  if (submitUrl && !/^https?:\/\//i.test(submitUrl)) submitUrl = 'https://' + submitUrl;
  if (submitUrl) { try { new URL(submitUrl); } catch { return Response.json({ error: 'Not a valid web address' }, { status: 400 }); } }
  const [row] = await q('update sites set submit_url = $2 where id = $1 returning id, url, submit_url as "submitUrl"', [id, submitUrl || null]);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(row);
});

export const DELETE = team(async (req, { params }) => {
  const { id } = await params;
  await q('delete from sites where id = $1', [id]);
  return Response.json({ ok: true });
});
