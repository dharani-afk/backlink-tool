import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { failStaleJobs } from '@/lib/util';

export const GET = team(async () => {
  await failStaleJobs(q);
  const jobs = await q(`select id, client_name as "clientName", url, status, note, runner, has_shot as "hasShot", updated_at as "updatedAt"
                        from jobs order by seq desc limit 500`);
  const runners = await q(`select name from runners where last_seen > now() - interval '30 seconds' order by name`);
  return Response.json({ jobs, runners: runners.map((r) => r.name) });
});
