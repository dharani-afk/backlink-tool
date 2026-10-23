// Postgres access. On Vercel set DATABASE_URL (Neon, Supabase or any Postgres).
// For Supabase use the "Transaction pooler" connection string (port 6543); prepare: false is required there.
// JSON goes in as text cast to jsonb ($n::text::jsonb): with a bare ::jsonb the postgres driver encodes the
// already-stringified value a second time and stores a JSON string instead of an object.
// Without DATABASE_URL (local development only) an embedded Postgres (PGlite) is stored in ./.localdb.
import postgres from 'postgres';

const SCHEMA = [
  `create table if not exists clients (
     id text primary key, data jsonb not null, created_at timestamptz not null default now())`,
  `create table if not exists docs (
     client_id text not null references clients(id) on delete cascade, name text not null,
     content bytea not null, primary key (client_id, name))`,
  `create table if not exists sites (
     id text primary key, url text not null unique, created_at timestamptz not null default now())`,
  // Listing page the runner found (or a person opened) on that site, so later runs go straight to it.
  `alter table sites add column if not exists submit_url text`,
  `create table if not exists jobs (
     id text primary key, seq bigserial, client_id text not null, client_name text not null,
     site_id text, url text not null, status text not null default 'pending', note text not null default '',
     review_mode boolean not null default true, human_action text, runner text,
     has_shot boolean not null default false, updated_at timestamptz not null default now())`,
  // Step-by-step record of what the runner did on a job (opened, signed in, fields filled, result evidence).
  `alter table jobs add column if not exists log jsonb not null default '[]'::jsonb`,
  `create table if not exists shots (
     job_id text primary key references jobs(id) on delete cascade, img bytea not null)`,
  `create table if not exists accounts (
     client_id text not null, host text not null, email text, username text,
     password_enc text not null, created_at timestamptz not null default now(), primary key (client_id, host))`,
  `create table if not exists runners (name text primary key, last_seen timestamptz not null default now())`,
  // On Supabase, tables in "public" are reachable through its REST API with the project's public key.
  // RLS with no policies closes that door; this app connects as the table owner, which RLS does not restrict.
  ...['clients', 'docs', 'sites', 'jobs', 'shots', 'accounts', 'runners'].map((t) => `alter table ${t} enable row level security`),
];

async function connect() {
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    // Hosted databases (Supabase, Neon) need SSL; a local Postgres usually has none.
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
    const sql = postgres(url, { prepare: false, max: 3, onnotice: () => {}, ssl: local ? false : 'require' });
    return { query: (text, params = []) => sql.unsafe(text, params) };
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL is not set. Add a Postgres database in the Vercel project settings.');
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(process.env.PGLITE_DIR || './.localdb');
  return { query: async (text, params = []) => (await pg.query(text, params)).rows };
}

async function init() {
  const db = await connect();
  for (const stmt of SCHEMA) {
    // Two cold starts creating the same table at once can race; the second attempt sees it exists.
    try { await db.query(stmt); } catch { await db.query(stmt); }
  }
  return db;
}

export async function q(text, params) {
  // Kept on globalThis so dev-mode reloads reuse one connection.
  if (!globalThis.__btdb) globalThis.__btdb = init().catch((e) => { globalThis.__btdb = null; throw e; });
  return (await globalThis.__btdb).query(text, params);
}
