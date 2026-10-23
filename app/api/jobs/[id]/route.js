import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { hostOf } from '@/lib/util';

// Everything about one job for the details view: its step-by-step log, the account used on that site
// (never the password) and the site's saved listing page.
export const GET = team(async (req, { params }) => {
  const { id } = await params;
  const [j] = await q(`select j.id, j.client_id, j.client_name as "clientName", j.url, j.status, j.note, j.runner,
      j.review_mode as "reviewMode", coalesce(j.mode, case when j.review_mode then 'review' else 'auto' end) as mode, j.has_shot as "hasShot", j.updated_at as "updatedAt", j.log,
      s.submit_url as "submitUrl"
    from jobs j left join sites s on s.id = j.site_id where j.id = $1`, [id]);
  if (!j) return Response.json({ error: 'not found' }, { status: 404 });
  const [a] = await q('select email, username, created_at as "createdAt" from accounts where client_id = $1 and host = $2', [j.client_id, hostOf(j.url)]);
  const { client_id, ...job } = j;
  return Response.json({ ...job, account: a || null });
});
