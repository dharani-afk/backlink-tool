import { q } from '@/lib/db';
import { runner } from '@/lib/auth';
import { dec, hostOf, failStaleJobs } from '@/lib/util';

// A runner asks for its next job. Each pending job goes to exactly one runner.
export const POST = runner(async (req) => {
  const { name } = await req.json();
  const who = String(name || 'runner').slice(0, 60);
  await q(`insert into runners (name, last_seen) values ($1, now()) on conflict (name) do update set last_seen = now()`, [who]);
  await failStaleJobs(q);
  const [job] = await q(`update jobs set status = 'running', note = 'Starting', runner = $1, human_action = null, updated_at = now()
    where id = (select id from jobs where status = 'pending' order by seq limit 1 for update skip locked)
    returning id, client_id, site_id, url, review_mode`, [who]);
  if (!job) return Response.json({ job: null });

  const [c] = await q('select data from clients where id = $1', [job.client_id]);
  if (!c) {
    await q(`update jobs set status = 'failed', note = 'Client no longer exists' where id = $1`, [job.id]);
    return Response.json({ job: null });
  }
  const [a] = await q('select email, username, password_enc from accounts where client_id = $1 and host = $2', [job.client_id, hostOf(job.url)]);
  const [site] = await q('select submit_url from sites where id = $1', [job.site_id || '']);
  return Response.json({
    job: { id: job.id, url: job.url, reviewMode: job.review_mode, clientId: job.client_id, submitUrl: site?.submit_url || null },
    client: c.data,
    account: a ? { email: a.email, username: a.username, password: dec(a.password_enc) } : null,
  });
});
