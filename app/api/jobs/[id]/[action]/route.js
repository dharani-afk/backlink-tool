import { q } from '@/lib/db';
import { team } from '@/lib/auth';

// The runner waiting on this job picks the action up on its next poll.
export const POST = team(async (req, { params }) => {
  const { id, action } = await params;
  if (!['continue', 'skip'].includes(action)) return Response.json({ error: 'bad action' }, { status: 400 });
  await q(`update jobs set human_action = $2 where id = $1 and status = 'needs_help'`, [id, action]);
  return Response.json({ ok: true });
});
