// One-off import of clients, documents, sites and saved site accounts from the old local tool (_old/backlink-tool).
// Account passwords are decrypted with the old data/vault.key and re-encrypted with VAULT_KEY. Old jobs are not imported.
// Usage (stop `npm run dev` first when using the local dev database):
//   node --env-file=.env.local scripts/import-old-data.mjs [path/to/old/data]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { q } from '../lib/db.js';
import { enc } from '../lib/util.js';

const DIR = path.resolve(process.argv[2] || '_old/backlink-tool/data');
const old = JSON.parse(fs.readFileSync(path.join(DIR, 'db.json'), 'utf8'));
const oldKey = fs.readFileSync(path.join(DIR, 'vault.key'));

function oldDec(s) {
  const [iv, tag, e] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', oldKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(e), d.final()]).toString('utf8');
}

let clients = 0, docs = 0, sites = 0, accounts = 0;

for (const { id, docs: _, ...data } of old.clients || []) {
  clients += (await q('insert into clients (id, data) values ($1, $2::text::jsonb) on conflict (id) do nothing returning id',
    [id, JSON.stringify(data)])).length;
  const dir = path.join(DIR, 'files', id);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    docs += (await q('insert into docs (client_id, name, content) values ($1, $2, $3) on conflict do nothing returning name',
      [id, name, fs.readFileSync(path.join(dir, name))])).length;
  }
}

for (const s of old.sites || []) {
  sites += (await q('insert into sites (id, url) values ($1, $2) on conflict do nothing returning id', [s.id, s.url])).length;
}

for (const a of old.accounts || []) {
  accounts += (await q(`insert into accounts (client_id, host, email, username, password_enc) values ($1, $2, $3, $4, $5)
    on conflict do nothing returning host`, [a.clientId, a.host, a.email, a.username, enc(oldDec(a.passwordEnc))])).length;
}

console.log(`Imported ${clients} clients, ${docs} documents, ${sites} sites, ${accounts} site accounts (existing rows were left as they were).`);
process.exit(0);
