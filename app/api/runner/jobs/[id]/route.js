import { q } from '@/lib/db';
import { runner } from '@/lib/auth';

const STATUSES = ['running', 'needs_help', 'submitted', 'unconfirmed', 'skipped', 'failed'];
const MAX_LOG = 300;

// Runner progress report and heartbeat. With takeAction it also collects (and clears) a
// Continue/Skip/Stop the team pressed in the dashboard. `log` entries are appended to the job's record.
export const POST = runner(async (req, { params }) => {
  const { id } = await params;
  const { status, note, takeAction, submitUrl, log } = await req.json();
  if (status && !STATUSES.includes(status)) return Response.json({ error: 'bad status' }, { status: 400 });
  // Oversized entries keep their text but lose their details, so one bad report cannot bloat the job.
  const entries = (Array.isArray(log) ? log : log ? [log] : []).slice(0, 20).map((e) => {
    const entry = { at: e.at || new Date().toISOString(), text: String(e.text || '').slice(0, 500), kind: e.kind || 'info', data: e.data };
    return JSON.stringify(entry).length > 6000 ? { ...entry, data: undefined } : entry;
  });
  const [row] = await q(`with old as (select id, human_action from jobs where id = $1 for update)
    update jobs set status = coalesce($2, jobs.status), note = coalesce($3, jobs.note), updated_at = now(),
      human_action = case when $4 then null else jobs.human_action end,
      log = case when $5::text is null then jobs.log
                 when jsonb_array_length(jobs.log) >= ${MAX_LOG} then jobs.log
                 else jobs.log || $5::text::jsonb end
    from old where jobs.id = old.id
    returning old.human_action as action, jobs.status, jobs.runner`,
  [id, status || null, note == null ? null : String(note).slice(0, 1000), !!takeAction,
    entries.length ? JSON.stringify(entries) : null]);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  // Every report also counts as the runner being alive, including long waits for a person.
  if (row.runner) await q(`update runners set last_seen = now() where name = $1`, [row.runner]);
  // The listing page the runner used on this site, kept on the site for the next run.
  if (submitUrl && /^https?:\/\//i.test(submitUrl)) {
    await q('update sites set submit_url = $2 where id = (select site_id from jobs where id = $1)', [id, String(submitUrl).slice(0, 2000)]);
  }
  return Response.json({ action: takeAction ? row.action : null, status: row.status });
});
