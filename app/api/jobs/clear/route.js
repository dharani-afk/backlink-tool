import { q } from '@/lib/db';
import { team } from '@/lib/auth';

// Remove finished jobs only; jobs still waiting or in progress stay.
export const POST = team(async () => {
  await q(`delete from jobs where status not in ('pending', 'running', 'needs_help')`);
  return Response.json({ ok: true });
});
