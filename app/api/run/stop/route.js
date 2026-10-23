import { q } from '@/lib/db';
import { team } from '@/lib/auth';

// Cancel queued jobs and release any job waiting for a person. A job mid-way finishes its current site.
export const POST = team(async () => {
  await q(`update jobs set status = 'skipped', note = 'Run stopped', updated_at = now() where status = 'pending'`);
  await q(`update jobs set human_action = 'skip' where status = 'needs_help'`);
  return Response.json({ ok: true });
});
