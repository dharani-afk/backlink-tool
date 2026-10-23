'use client';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Icon from './icons';

const SECTIONS = [
  ['Basics', [
    ['name', 'Business / product name'], ['url', 'Website URL', '', '', 'e.g. https://medkorse.in'],
    ['email', 'Sign-up email', '', '', 'A mailbox your team can read. Sites send verification links here.'], ['category', 'Category'],
    ['tagline', 'Tagline', 'full'], ['keywords', 'Keywords', 'full', '', 'Comma separated'],
  ]],
  ['Descriptions', [['shortDesc', 'Short description', 'full', 'textarea', 'About 150 characters'], ['longDesc', 'Long description', 'full', 'textarea']]],
  ['Contact & location', [['phone', 'Phone', '', '', 'Only used on forms that ask for it'], ['address', 'Address'], ['city', 'City'], ['country', 'Country']]],
  ['Brand & social', [['logoUrl', 'Logo URL', 'full', '', 'A link to the logo image, e.g. https://example.com/logo.png. Leave empty if none.'],
    ['facebook', 'Facebook', '', '', 'Page link, e.g. https://facebook.com/yourpage'], ['twitter', 'Twitter / X', '', '', 'e.g. https://x.com/yourname'],
    ['linkedin', 'LinkedIn', '', '', 'e.g. https://linkedin.com/company/yourco'], ['instagram', 'Instagram', '', '', 'e.g. https://instagram.com/yourname']]],
  ['Internal', [['notes', 'Notes (not submitted anywhere)', 'full', 'textarea']]],
];
const FIELDS = SECTIONS.flatMap(([, f]) => f);
const EMPTY = Object.fromEntries(FIELDS.map(([k]) => [k, '']));
const ACTIVE = ['pending', 'running', 'needs_help'];
const STATUS_LABEL = { pending: 'Queued', running: 'Running', needs_help: 'Needs you', submitted: 'Submitted', unconfirmed: 'Unconfirmed', failed: 'Failed', skipped: 'Skipped' };

async function api(p, o = {}) {
  const r = await fetch('/api' + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, o));
  if (r.status === 401) { window.location.href = '/login'; return {}; }
  return r.json().catch(() => ({}));
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}
const Avatar = ({ text, size }) => <span className={'avatar' + (size ? ' ' + size : '')}>{(text || '?').trim()[0]?.toUpperCase()}</span>;

export default function Dashboard() {
  const [tab, setTab] = useState('run');
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [runners, setRunners] = useState([]);
  const [runnerInfo, setRunnerInfo] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [ready, setReady] = useState(false);

  const notify = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    // Problems stay long enough to read (they can be a few sentences).
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'ok' ? 3500 : 9000);
  }, []);

  const loadClients = useCallback(async () => { const c = await api('/clients'); if (Array.isArray(c)) setClients(c); return c; }, []);
  const loadSites = useCallback(async () => { const s = await api('/sites'); if (Array.isArray(s)) setSites(s); }, []);
  const loadJobs = useCallback(async () => {
    const d = await api('/jobs');
    if (d.jobs) { setJobs(d.jobs); setRunners(d.runners); setRunnerInfo(d.runnerInfo || []); }
  }, []);

  useEffect(() => {
    Promise.all([loadClients(), loadSites(), loadJobs()]).finally(() => setReady(true));
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, [loadClients, loadSites, loadJobs]);

  const help = jobs.filter((j) => j.status === 'needs_help');
  const nav = [
    ['run', 'Run', 'play', help.length],
    ['clients', 'Clients', 'users', 0, clients.length],
    ['sites', 'Sites', 'globe', 0, sites.length],
    ['setup', 'Runner setup', 'monitor'],
  ];
  const titles = {
    run: ['Run', 'Queue sites for a client and watch progress live.'],
    clients: ['Clients', 'The details that get filled into each submission form.'],
    sites: ['Sites', 'Directories and listing sites to submit to.'],
    setup: ['Runner setup', 'Connect a team PC so Chrome can do the sign-ups.'],
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="logo" size={18} /></span>Backlink Tool</div>
        <nav>
          {nav.map(([k, l, icon, alert, count]) => (
            <button key={k} className={'nav-item' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>
              <Icon name={icon} /><span>{l}</span>
              {alert ? <span className="badge alert">{alert}</span> : count ? <span className="badge">{count}</span> : null}
            </button>))}
        </nav>
        <div className="sidebar-foot">
          <div className={'runner-status' + (runners.length ? ' on' : '')}>
            <span className="pulse" />
            <div><strong>{runners.length ? `Runner online${runners.length > 1 ? ` (${runners.length})` : ''}` : 'No runner online'}</strong>
              {runners.length ? runnerInfo.map((r) => (
                <small key={r.name}>{r.name}: {r.busyWith ? `${r.busyStatus === 'needs_help' ? 'waiting for you on' : 'working on'} ${hostOf(r.busyWith)}` : 'idle, waiting for sites'}</small>))
                : <small>Queued sites will wait</small>}</div>
          </div>
          <button className="nav-item" onClick={async () => { await api('/login', { method: 'DELETE' }); window.location.href = '/login'; }}>
            <Icon name="logout" /><span>Log out</span></button>
        </div>
      </aside>

      <main className="content">
        <div className="page-head"><h1>{titles[tab][0]}</h1><p>{titles[tab][1]}</p></div>
        {tab === 'clients' && <Clients clients={clients} reload={loadClients} notify={notify} />}
        {tab === 'sites' && <Sites sites={sites} reload={loadSites} notify={notify} />}
        {tab === 'run' && <Run clients={clients} sites={sites} jobs={jobs} runners={runners} runnerInfo={runnerInfo} help={help} reload={loadJobs} notify={notify} go={setTab} ready={ready} />}
        {tab === 'setup' && <Setup notify={notify} />}
      </main>

      <div className="toasts">{toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}><Icon name={t.kind === 'ok' ? 'check' : 'alert'} />{t.text}</div>)}</div>
    </div>
  );
}

function Clients({ clients, reload, notify }) {
  const [currentId, setCurrentId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const current = clients.find((c) => c.id === currentId);
  const shown = clients.filter((c) => (c.name + ' ' + c.url).toLowerCase().includes(query.toLowerCase()));

  function pick(id) {
    setCurrentId(id);
    const c = clients.find((x) => x.id === id);
    setForm(c ? Object.fromEntries(FIELDS.map(([k]) => [k, c[k] || ''])) : EMPTY);
  }
  async function save() {
    setBusy(true);
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
    const r = currentId ? await api('/clients/' + currentId, { method: 'PUT', body: JSON.stringify(body) }) : await post('/clients', body);
    setBusy(false);
    if (r.error) return notify(r.error, 'bad');
    await reload(); setCurrentId(r.id);
    notify(currentId ? 'Client saved' : 'Client created');
  }
  async function del() {
    if (!currentId || !confirm(`Delete ${current?.name || 'this client'} and its saved site accounts?`)) return;
    await api('/clients/' + currentId, { method: 'DELETE' }); pick(''); reload();
    notify('Client deleted');
  }
  async function upload(files) {
    if (!currentId) return notify('Save the client first', 'bad');
    for (const file of files) {
      const r = await fetch(`/api/clients/${currentId}/files?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) notify(`${file.name}: ${d.error || 'upload failed'}`, 'bad');
      else notify(`Uploaded ${file.name}`);
    }
    if (fileRef.current) fileRef.current.value = '';
    reload();
  }

  return (
    <div className="split">
      <section className="card list-card">
        <div className="list-head">
          <div className="search"><Icon name="search" /><input placeholder="Search clients" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <button className="btn icon-only" title="New client" onClick={() => pick('')}><Icon name="plus" /></button>
        </div>
        <div className="list">
          <button className={'list-item' + (!currentId ? ' active' : '')} onClick={() => pick('')}>
            <span className="avatar ghost"><Icon name="plus" size={14} /></span><div><strong>New client</strong><small>Start a blank profile</small></div></button>
          {shown.map((c) => (
            <button key={c.id} className={'list-item' + (c.id === currentId ? ' active' : '')} onClick={() => pick(c.id)}>
              <Avatar text={c.name} /><div><strong>{c.name}</strong><small>{hostOf(c.url)}</small></div></button>))}
          {!shown.length && clients.length > 0 && <p className="empty-note">No clients match “{query}”.</p>}
        </div>
      </section>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div className="row">{current ? <Avatar text={current.name} size="lg" /> : <span className="avatar lg ghost"><Icon name="plus" /></span>}
              <div><h2>{current ? current.name : 'New client'}</h2><p className="muted">{current ? hostOf(current.url) : 'Name and website URL are required.'}</p></div></div>
          </div>
          {SECTIONS.map(([title, fields]) => (
            <fieldset key={title}>
              <legend>{title}</legend>
              <div className="grid">
                {fields.map(([k, l, cls, kind, hint]) => (
                  <div key={k} className={'field ' + (cls || '')}>
                    <label htmlFor={'f_' + k}>{l}{k === 'shortDesc' && <span className={'count' + (form[k].length > 160 ? ' over' : '')}>{form[k].length}</span>}</label>
                    {kind === 'textarea'
                      ? <textarea id={'f_' + k} value={form[k]} rows={k === 'longDesc' ? 5 : 3} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                      : <input id={'f_' + k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
                    {hint && <small className="hint">{hint}</small>}
                  </div>))}
              </div>
            </fieldset>))}
          <div className="action-bar">
            {currentId && <button className="btn danger-ghost" onClick={del}><Icon name="trash" />Delete</button>}
            <span className="grow" />
            <button className="btn ghost" onClick={() => pick(currentId)}>Discard changes</button>
            <button className="btn primary" onClick={save} disabled={busy}><Icon name="check" />{currentId ? 'Save changes' : 'Create client'}</button>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Documents</h2><p className="muted">Logos, brochures or anything a site may ask for. Up to 4 MB per file.</p></div></div>
          <label className={'dropzone' + (drag ? ' drag' : '') + (!currentId ? ' disabled' : '')}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files]); }}>
            <input ref={fileRef} type="file" multiple hidden disabled={!currentId} onChange={(e) => upload([...e.target.files])} />
            <Icon name="upload" size={22} />
            <strong>{currentId ? 'Drop files here or click to browse' : 'Save the client first'}</strong>
          </label>
          {current?.docs?.length > 0 && <ul className="docs">{current.docs.map((d) => (
            <li key={d}><Icon name="file" /><a href={`/api/clients/${current.id}/files/${encodeURIComponent(d)}`}>{d}</a><Icon name="download" /></li>))}</ul>}
        </section>
      </div>
    </div>
  );
}

function Sites({ sites, reload, notify }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // { id, value } while a listing page is being edited
  const pending = text.split(/[\s,]+/).filter(Boolean).length;
  const shown = sites.filter((s) => s.url.toLowerCase().includes(query.toLowerCase()));
  // Runners save listing pages while the team works; show the latest when the tab opens.
  useEffect(() => { reload(); }, [reload]);

  async function saveListing(id, value) {
    const r = await api('/sites/' + id, { method: 'PATCH', body: JSON.stringify({ submitUrl: value }) });
    if (r.error) return notify(r.error, 'bad');
    setEditing(null); reload();
    notify(value ? 'Listing page saved: the runner goes straight there next time' : 'Listing page cleared: the runner will search the site again');
  }

  async function add() {
    const r = await post('/sites', { urls: text });
    const n = Array.isArray(r) ? r.length : 0;
    notify(n ? `Added ${n} site${n > 1 ? 's' : ''}` : 'No new sites (already listed or not valid URLs)', n ? 'ok' : 'bad');
    setText(''); reload();
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><div><h2>Add sites</h2><p className="muted">Paste one URL per line, or separate them with commas. Duplicates are skipped.</p></div></div>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'example-directory.com\nhttps://another-listing-site.org/submit'} />
        <div className="action-bar">
          <span className="muted">{pending ? `${pending} URL${pending > 1 ? 's' : ''} ready to add` : ''}</span><span className="grow" />
          <button className="btn primary" onClick={add} disabled={!pending}><Icon name="plus" />Add sites</button>
        </div>
      </section>
      <section className="card flush">
        <div className="card-head padded">
          <div><h2>Site list</h2><p className="muted">{sites.length} site{sites.length === 1 ? '' : 's'}</p></div>
          <div className="search"><Icon name="search" /><input placeholder="Filter sites" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        </div>
        {shown.length ? <ul className="rows">{shown.map((s) => (
          <li key={s.id}>
            <Avatar text={hostOf(s.url)} />
            <div className="grow"><strong>{hostOf(s.url)}</strong><small>{s.url}</small>
              {editing?.id === s.id ? (
                <div className="row listing-edit">
                  <input autoFocus value={editing.value} placeholder="https://site.com/add-your-business"
                    onChange={(e) => setEditing({ id: s.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveListing(s.id, editing.value); if (e.key === 'Escape') setEditing(null); }} />
                  <button className="btn primary" onClick={() => saveListing(s.id, editing.value)}>Save</button>
                  {s.submitUrl && <button className="btn ghost" onClick={() => saveListing(s.id, '')}>Clear</button>}
                  <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : s.submitUrl
                ? <small>Listing page: <a href={s.submitUrl} target="_blank" rel="noreferrer">{s.submitUrl}</a></small>
                : <small className="muted">Listing page: not known yet (the runner searches the site)</small>}</div>
            <button className="btn icon-only ghost" title="Set the listing page" onClick={() => setEditing({ id: s.id, value: s.submitUrl || '' })}><Icon name="edit" /></button>
            <a className="btn icon-only ghost" href={s.url} target="_blank" rel="noreferrer" title="Open site"><Icon name="external" /></a>
            <button className="btn icon-only danger-ghost" title="Remove" onClick={async () => { await api('/sites/' + s.id, { method: 'DELETE' }); reload(); }}><Icon name="trash" /></button>
          </li>))}</ul>
          : <div className="empty"><Icon name="globe" size={28} /><p>{sites.length ? 'No sites match your filter.' : 'No sites yet. Paste some above to get started.'}</p></div>}
      </section>
    </div>
  );
}

function Run({ clients, sites, jobs, runners, runnerInfo, help, reload, notify, go, ready }) {
  const [clientId, setClientId] = useState('');
  const [mode, setMode] = useState('review');
  const [starting, setStarting] = useState(false);
  const [openJob, setOpenJob] = useState(null);
  const closeJob = useCallback(() => setOpenJob(null), []);
  const [off, setOff] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const cid = clientId || clients[0]?.id || '';
  const selected = sites.filter((s) => !off.has(s.id));
  const shownSites = sites.filter((s) => s.url.toLowerCase().includes(query.toLowerCase()));

  const counts = useMemo(() => {
    const c = { pending: 0, running: 0, needs_help: 0, submitted: 0, unconfirmed: 0, failed: 0, skipped: 0 };
    for (const j of jobs) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }, [jobs]);
  const active = counts.pending + counts.running + counts.needs_help;
  const filters = [['all', 'All', jobs.length], ['active', 'Active', active], ['needs_help', 'Needs you', counts.needs_help],
    ['submitted', 'Submitted', counts.submitted], ['unconfirmed', 'Unconfirmed', counts.unconfirmed], ['failed', 'Failed', counts.failed], ['skipped', 'Skipped', counts.skipped]];
  const shownJobs = jobs.filter((j) => filter === 'all' || (filter === 'active' ? ACTIVE.includes(j.status) : j.status === filter));

  function toggle(id) { const n = new Set(off); n.has(id) ? n.delete(id) : n.add(id); setOff(n); }
  async function start() {
    setStarting(true);
    const r = await post('/run', { clientId: cid, siteIds: selected.map((s) => s.id), reviewMode: mode === 'review' }).finally(() => setStarting(false));
    if (r.error) return notify(r.error, 'bad');
    const plural = (n) => `${n} site${n === 1 ? '' : 's'}`;
    if (!r.queued) notify(`Nothing new queued: ${plural(r.alreadyQueued)} already queued or running for this client`, 'bad');
    else notify(`Queued ${plural(r.queued)}${r.alreadyQueued ? `; ${plural(r.alreadyQueued)} were already queued, so not added again` : ''}${runners.length ? '' : '. Start a runner so they begin'}`);
    reload();
  }
  const act = (p, msg) => post(p).then(() => { notify(msg); reload(); });

  return (
    <div className="stack">
      <div className="stats">
        {[['Queued', counts.pending, ''], ['Running', counts.running, 'info'], ['Needs you', counts.needs_help, 'warn'],
          ['Submitted', counts.submitted, 'ok'], ['Unconfirmed', counts.unconfirmed, 'warn'], ['Failed', counts.failed, 'bad']].map(([l, n, k]) => (
          <div key={l} className={'stat ' + k}><span>{l}</span><strong>{n}</strong></div>))}
      </div>

      {!runners.length ? (
        <div className="banner"><Icon name="monitor" size={18} />
          <div><strong>No runner is online.</strong> {active ? `${active} site${active === 1 ? ' is' : 's are'} waiting. ` : ''}Queued sites start when a team PC opens the <strong>Backlink Runner</strong> (desktop shortcut).</div>
          <button className="btn ghost" onClick={() => go('setup')}>Set up a runner</button></div>
      ) : (
        <div className="banner ok"><span className="pulse" />
          <div>{runnerInfo.map((r) => (
            <div key={r.name}><strong>{r.name}</strong>: {r.busyWith ? <>{r.busyStatus === 'needs_help' ? 'waiting for you on ' : 'working on '}<strong>{hostOf(r.busyWith)}</strong></> : counts.pending ? 'starting the next site' : 'online, waiting for sites'}</div>))}</div>
        </div>)}

      {help.map((j) => (
        <section key={j.id} className="card needs">
          <div className="needs-icon"><Icon name="alert" size={20} /></div>
          <div className="grow">
            <div className="row"><strong>{hostOf(j.url)}</strong><span className="pill needs_help">Needs you</span><span className="muted">Chrome on {j.runner} · {j.clientName}</span></div>
            <p>{j.note}</p>
            <div className="row">
              <button className="btn primary" onClick={() => act(`/jobs/${j.id}/continue`, 'Continuing')}><Icon name="play" />Continue</button>
              <button className="btn ghost" onClick={() => act(`/jobs/${j.id}/skip`, 'Skipped')}><Icon name="skip" />Skip this site</button>
              <button className="btn ghost" onClick={() => setOpenJob(j.id)}><Icon name="list" />What it did</button>
              {j.hasShot && <a className="btn ghost" href={`/api/shots/${j.id}`} target="_blank" rel="noreferrer"><Icon name="image" />Screenshot</a>}
            </div>
          </div>
        </section>))}

      <section className="card">
        <div className="card-head"><div><h2>Start a run</h2><p className="muted">Chrome opens on a runner PC and works through the sites one at a time.</p></div></div>
        {!ready ? <div className="skeleton" /> : !clients.length || !sites.length ? (
          <div className="empty"><Icon name="play" size={28} />
            <p>{!clients.length ? 'Add a client first.' : 'Add some sites first.'}</p>
            <button className="btn primary" onClick={() => go(!clients.length ? 'clients' : 'sites')}>{!clients.length ? 'Go to Clients' : 'Go to Sites'}</button></div>
        ) : (<>
          <div className="grid">
            <div className="field"><label htmlFor="run_client">Client</label>
              <select id="run_client" value={cid} onChange={(e) => setClientId(e.target.value)}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="field"><label>Mode</label>
              <div className="segmented">
                <button className={mode === 'review' ? 'on' : ''} onClick={() => setMode('review')}>Review each submit</button>
                <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>Fully automatic</button>
              </div>
              <small className="hint">{mode === 'review' ? 'Recommended. Fills the form, then waits for you to check it.' : 'Presses Submit itself; still pauses for CAPTCHAs and email checks.'}</small></div>
          </div>
          <div className="field site-pick">
            <div className="row spread">
              <label>Sites <span className="muted">· {selected.length} of {sites.length} selected</span></label>
              <div className="row">
                <div className="search small"><Icon name="search" size={14} /><input placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
                <button className="link" onClick={() => setOff(new Set())}>All</button>
                <button className="link" onClick={() => setOff(new Set(sites.map((s) => s.id)))}>None</button>
              </div>
            </div>
            <div className="chips">{shownSites.map((s) => (
              <button key={s.id} className={'chip' + (off.has(s.id) ? '' : ' on')} onClick={() => toggle(s.id)} title={s.url}>
                <span className="tick"><Icon name="check" size={12} /></span>{hostOf(s.url)}</button>))}</div>
          </div>
          <div className="action-bar">
            <button className="btn danger-ghost" onClick={() => act('/run/stop', 'Stopping run')} disabled={!active}><Icon name="stop" />Stop</button>
            <span className="grow" />
            <button className="btn primary lg" onClick={start} disabled={!selected.length || starting}><Icon name="play" />{starting ? 'Queueing…' : `Start run · ${selected.length} site${selected.length === 1 ? '' : 's'}`}</button>
          </div>
        </>)}
      </section>

      <section className="card flush">
        <div className="card-head padded">
          <div><h2>Jobs</h2><p className="muted">{active ? `${active} queued or in progress · updates every 3 seconds` : 'Idle'}</p></div>
          <button className="btn ghost" onClick={() => act('/jobs/clear', 'Cleared finished jobs')}><Icon name="sweep" />Clear finished</button>
        </div>
        <div className="tabs">{filters.map(([k, l, n]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<span>{n}</span></button>))}</div>
        {shownJobs.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Site</th><th>Status</th><th>Note</th><th>Updated</th><th /></tr></thead>
            <tbody>{shownJobs.map((j) => (
              <tr key={j.id} className="clickable" onClick={(e) => { if (!e.target.closest('a')) setOpenJob(j.id); }} title="Show what the runner did on this site">
                <td><strong>{hostOf(j.url)}</strong><small>{j.clientName}</small></td>
                <td><span className={'pill ' + j.status}>{STATUS_LABEL[j.status] || j.status}</span></td>
                <td className="note">{j.note}{j.runner && <small>on {j.runner}</small>}</td>
                <td className="muted nowrap">{ago(j.updatedAt)}</td>
                <td>{j.hasShot && <a className="btn icon-only ghost" href={`/api/shots/${j.id}`} target="_blank" rel="noreferrer" title="Screenshot"><Icon name="image" /></a>}</td>
              </tr>))}</tbody>
          </table></div>
        ) : <div className="empty"><Icon name="play" size={28} /><p>{jobs.length ? 'No jobs in this view.' : 'No jobs yet. Start a run above.'}</p></div>}
      </section>
      {openJob && <JobDetails id={openJob} close={closeJob} />}
    </div>
  );
}

const STEP_ICON = { ok: 'check', warn: 'alert', bad: 'x', person: 'users', info: 'play' };

// Everything the runner did on one site: the timeline of steps, the fields it filled and with what,
// the account it used, the listing page and the latest screenshot. Refreshes while the job is active.
function JobDetails({ id, close }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api('/jobs/' + id).then((r) => { if (alive) setD(r); });
    load();
    const t = setInterval(load, 3000);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [id, close]);
  const log = d?.log || [];
  const fieldSteps = log.filter((s) => s.data?.fields?.length);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside className="drawer" role="dialog" aria-label="Job details">
        <div className="drawer-head">
          <div><h2>{d ? hostOf(d.url) : 'Loading…'}</h2>
            {d && <p className="muted">{d.clientName} · {d.reviewMode ? 'Review each submit' : 'Fully automatic'}{d.runner ? ` · Chrome on ${d.runner}` : ''}</p>}</div>
          <button className="btn icon-only ghost" title="Close" onClick={close}><Icon name="x" /></button>
        </div>
        {d && !d.error && (<div className="drawer-body">
          <div className="row"><span className={'pill ' + d.status}>{STATUS_LABEL[d.status] || d.status}</span><span className="muted">{ago(d.updatedAt)}</span></div>
          <p className="drawer-note">{d.note}</p>
          <dl className="facts">
            <dt>Site</dt><dd><a href={d.url} target="_blank" rel="noreferrer">{d.url}</a></dd>
            <dt>Listing page</dt><dd>{d.submitUrl ? <a href={d.submitUrl} target="_blank" rel="noreferrer">{d.submitUrl}</a> : <span className="muted">not known yet</span>}</dd>
            <dt>Account</dt><dd>{d.account ? <>{d.account.email || d.account.username}{d.account.username && d.account.email ? ` (username ${d.account.username})` : ''} <span className="muted">· saved {ago(d.account.createdAt)}</span></> : <span className="muted">none created on this site</span>}</dd>
          </dl>
          {fieldSteps.map((s, i) => (
            <div key={i}><h3>{s.text}</h3>
              <table className="mini"><thead><tr><th>Field on the site</th><th>Filled with</th></tr></thead>
                <tbody>{s.data.fields.map((f, k) => <tr key={k}><td>{f.field}<small>{f.as}</small></td><td>{f.value}</td></tr>)}</tbody></table></div>))}
          <h3>What happened</h3>
          {log.length ? <ol className="timeline">{log.map((s, i) => (
            <li key={i} className={s.kind}><span className="dot"><Icon name={STEP_ICON[s.kind] || 'play'} size={12} /></span>
              <div><span>{s.text}</span><small>{new Date(s.at).toLocaleTimeString()}</small></div></li>))}</ol>
            : <p className="muted">No steps recorded yet{d.status === 'pending' ? ': this site is waiting for a runner.' : '. (Jobs from before this update have only the note above.)'}</p>}
          {d.hasShot && <><h3>Latest screenshot</h3>
            <a href={`/api/shots/${d.id}`} target="_blank" rel="noreferrer"><img className="shot" src={`/api/shots/${d.id}?t=${new Date(d.updatedAt).getTime()}`} alt="Latest screenshot of the site" /></a></>}
        </div>)}
      </aside>
    </div>
  );
}

function Setup({ notify }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); api('/runner-token').then((d) => setToken(d.token || '')); }, []);
  const copy = (v, what) => navigator.clipboard.writeText(v).then(() => notify(`${what} copied`));
  // Windows blocks a downloaded Start Runner.bat (Smart App Control, SmartScreen), so Windows PCs install with
  // one PowerShell command instead: nothing it downloads carries the "from the internet" mark.
  const installCmd = (t) => `& ([scriptblock]::Create((irm ${origin}/install.ps1))) -Server ${origin} -Token ${t}`;

  const steps = [
    ['Install Google Chrome', <>If the PC doesn&apos;t have it, get it from <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">google.com/chrome</a>.</>],
    ['Copy the install command', <>It already contains this dashboard&apos;s address and the runner token.</>],
    ['Run it in PowerShell', <>Press <strong>Start</strong>, type <strong>PowerShell</strong>, press <strong>Enter</strong>. Paste the command (right-click), press <strong>Enter</strong>. It installs the runner (about a minute the first time), adds a <strong>Backlink Runner</strong> shortcut to the desktop and starts it.</>],
    ['Keep the runner window open', <>The status in the sidebar turns green when the runner is online. Queued sites then start automatically. Next time, double-click <strong>Backlink Runner</strong> on the desktop.</>],
  ];

  return (
    <div className="stack narrow">
      <section className="card">
        <p className="lead">The website stores clients, sites and results. The sign-ups themselves happen in Google Chrome on a team member&apos;s PC, so a person can solve CAPTCHAs and click email links. That PC runs a small program called the <strong>runner</strong>.</p>
        <ol className="steps">{steps.map(([t, body], i) => (
          <li key={t}><span className="step-num">{i + 1}</span><div><strong>{t}</strong><div className="step-body">{body}</div>
            {i === 1 && <div className="secrets">
              <div className="secret"><label><Icon name="lock" size={12} /> Windows install command (contains the runner token, keep private)</label>
                <code>{token ? installCmd(show ? token : '•'.repeat(32)) : 'RUNNER_TOKEN is not set on the server'}</code>
                {token && <button className="btn icon-only ghost" title={show ? 'Hide token' : 'Show token'} onClick={() => setShow(!show)}><Icon name={show ? 'eyeOff' : 'eye'} /></button>}
                {token && <button className="btn icon-only ghost" title="Copy" onClick={() => copy(installCmd(token), 'Install command')}><Icon name="copy" /></button>}</div>
            </div>}</div></li>))}</ol>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>On a Mac, or installing by hand</h2>
          <p className="muted">Download the runner, unzip it and double-click <strong>Start Runner (Mac).command</strong>. When asked, paste these two values. On Windows use the command above: Windows blocks a downloaded Start Runner.bat.</p></div></div>
        <div className="row"><a className="btn" href="/backlink-runner.zip"><Icon name="download" />Download runner (.zip)</a></div>
        <div className="secrets">
          <div className="secret"><label>Dashboard address</label><code>{origin}</code>
            <button className="btn icon-only ghost" title="Copy" onClick={() => copy(origin, 'Address')}><Icon name="copy" /></button></div>
          <div className="secret"><label><Icon name="lock" size={12} /> Runner token (keep private)</label>
            <code>{token ? (show ? token : '•'.repeat(32)) : 'RUNNER_TOKEN is not set on the server'}</code>
            {token && <button className="btn icon-only ghost" title={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)}><Icon name={show ? 'eyeOff' : 'eye'} /></button>}
            {token && <button className="btn icon-only ghost" title="Copy" onClick={() => copy(token, 'Token')}><Icon name="copy" /></button>}</div>
        </div>
      </section>
    </div>
  );
}
