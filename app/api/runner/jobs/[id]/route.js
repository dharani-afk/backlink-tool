import { q } from '@/lib/db';
import { runner } from '@/lib/auth';

const STATUSES = ['running', 'needs_help', 'submitted', 'unconfirmed', 'skipped', 'failed'];

// Runner progress report and heartbeat. With takeAction it also collects (and clears) a
// Continue/Skip the team pressed in the dashboard.
export const POST = runner(async (req, { params }) => {
  const { id } = await params;
  const { status, note, takeAction, submitUrl } = await req.json();
  if (status && !STATUSES.includes(status)) return Response.json({ error: 'bad status' }, { status: 400 });
  const [row] = await q(`with old as (select id, human_action from jobs where id = $1 for update)
    update jobs set status = coalesce($2, jobs.status), note = coalesce($3, jobs.note), updated_at = now(),
      human_action = case when $4 then null else jobs.human_action end
    from old where jobs.id = old.id
    returning old.human_action as action, jobs.status`,
  [id, status || null, note == null ? null : String(note).slice(0, 1000), !!takeAction]);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  // The listing page the runner used on this site, kept on the site for the next run.
  if (submitUrl && /^https?:\/\//i.test(submitUrl)) {
    await q('update sites set submit_url = $2 where id = (select site_id from jobs where id = $1)', [id, String(submitUrl).slice(0, 2000)]);
  }
  return Response.json({ action: takeAction ? row.action : null, status: row.status });
});
