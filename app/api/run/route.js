import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { id } from '@/lib/util';

// Queue one job per site. Runners on team PCs claim them one at a time.
export const POST = team(async (req) => {
  const { clientId, siteIds, reviewMode } = await req.json();
  const [client] = await q('select id, data from clients where id = $1', [clientId || '']);
  if (!client) return Response.json({ error: 'Pick a client' }, { status: 400 });
  const sites = await q('select id, url from sites where id = any($1::text[]) order by created_at, url', [siteIds || []]);
  if (!sites.length) return Response.json({ error: 'Pick at least one site' }, { status: 400 });
  for (const s of sites) {
    await q(`insert into jobs (id, client_id, client_name, site_id, url, review_mode) values ($1, $2, $3, $4, $5, $6)`,
      [id(), client.id, client.data.name, s.id, s.url, reviewMode !== false]);
  }
  return Response.json({ queued: sites.length });
});
