import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { failStaleJobs, RUNNER_ONLINE_SECONDS } from '@/lib/util';

export const GET = team(async () => {
  await failStaleJobs(q);
  const jobs = await q(`select id, client_name as "clientName", url, status, note, runner, has_shot as "hasShot", updated_at as "updatedAt"
                        from jobs order by seq desc limit 500`);
  // Each online runner with the site it is on right now (if any), so the dashboard can say what it is doing.
  const runners = await q(`select r.name, r.last_seen as "lastSeen",
      (select j.url from jobs j where j.runner = r.name and j.status in ('running', 'needs_help') order by j.updated_at desc limit 1) as "busyWith",
      (select j.status from jobs j where j.runner = r.name and j.status in ('running', 'needs_help') order by j.updated_at desc limit 1) as "busyStatus"
    from runners r where r.last_seen > now() - interval '${RUNNER_ONLINE_SECONDS} seconds' order by r.name`);
  return Response.json({ jobs, runners: runners.map((r) => r.name), runnerInfo: runners });
});
