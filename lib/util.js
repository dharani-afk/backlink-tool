// AES-256-GCM vault for generated site passwords (key from VAULT_KEY), ids, and shared helpers.
import crypto from 'crypto';

function key() {
  const k = process.env.VAULT_KEY;
  if (!k) throw new Error('VAULT_KEY is not set');
  return crypto.createHash('sha256').update(k).digest();
}

export function enc(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const e = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), e].map((b) => b.toString('base64')).join('.');
}

export function dec(s) {
  const [iv, tag, e] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(e), d.final()]).toString('utf8');
}

export const id = () => crypto.randomBytes(6).toString('hex');
export const hostOf = (u) => new URL(u).hostname.replace(/^www\./, '');

export const CLIENT_FIELDS = [
  'name', 'url', 'email', 'tagline', 'shortDesc', 'longDesc', 'keywords',
  'category', 'phone', 'address', 'city', 'country', 'logoUrl', 'facebook',
  'twitter', 'linkedin', 'instagram', 'notes',
];

// Vercel rejects request bodies over 4.5 MB.
export const MAX_UPLOAD = 4 * 1024 * 1024;

// Jobs a runner is working on; the runner pings at least every 30 s, so silence means it is gone.
export const ACTIVE = ['pending', 'running', 'needs_help'];
export async function failStaleJobs(q) {
  await q(`update jobs set status = 'failed', note = 'Runner stopped responding (window closed or connection lost)', updated_at = now()
           where status in ('running', 'needs_help') and updated_at < now() - interval '2 minutes'`);
}
