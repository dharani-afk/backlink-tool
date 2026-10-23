import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { id, ACTIVE } from '@/lib/util';

// Queue one job per site. Runners on team PCs claim them one at a time.
// A site that already has a queued or running job for this client is not queued again,
// so pressing Start twice never doubles the work.
const MODES = ['review', 'auto', 'find'];

export const POST = team(async (req) => {
  const { clientId, siteIds, reviewMode, mode: asked } = await req.json();
  const mode = MODES.includes(asked) ? asked : reviewMode === false ? 'auto' : 'review';
  const [client] = await q('select id, data from clients where id = $1', [clientId || '']);
  if (!client) return Response.json({ error: 'Pick a client' }, { status: 400 });
  const sites = await q('select id, url from sites where id = any($1::text[]) order by created_at, url', [siteIds || []]);
  if (!sites.length) return Response.json({ error: 'Pick at least one site' }, { status: 400 });
  const busy = new Set((await q('select site_id from jobs where client_id = $1 and status = any($2::text[])', [client.id, ACTIVE])).map((r) => r.site_id));
  let queued = 0;
  for (const s of sites) {
    if (busy.has(s.id)) continue;
    await q(`insert into jobs (id, client_id, client_name, site_id, url, review_mode, mode) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id(), client.id, client.data.name, s.id, s.url, mode === 'review', mode]);
    queued++;
  }
  return Response.json({ queued, alreadyQueued: sites.length - queued });
});
