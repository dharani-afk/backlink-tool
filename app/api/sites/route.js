import { q } from '@/lib/db';
import { team } from '@/lib/auth';
import { id } from '@/lib/util';

export const GET = team(async () => Response.json(await q('select id, url, submit_url as "submitUrl" from sites order by created_at, url')));

export const POST = team(async (req) => {
  const { urls } = await req.json();
  const added = [];
  for (let u of String(urls || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { new URL(u); } catch { continue; }
    const rows = await q('insert into sites (id, url) values ($1, $2) on conflict (url) do nothing returning id, url', [id(), u]);
    added.push(...rows);
  }
  return Response.json(added);
});
