// Backlink Tool runner: runs on a team member's PC, takes queued sites from the online dashboard,
// and works through them ONE AT A TIME in a visible Chrome window.
// It never tries to defeat CAPTCHAs. When it meets a CAPTCHA, an email-verification step,
// or a form it cannot understand, it pauses that site, keeps the page open, and waits for a person.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const readline = require('readline');
const { chromium } = require('playwright-core');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const HUMAN_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_POLL_MS = 5000;
const CLOSE_CHROME_AFTER_IDLE_MS = 60 * 1000;
const SKIP = 'skip';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
let cfg;

// ---- Config (asked once, saved to config.json) ---------------------------------
async function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));
  console.log('\nFirst start: connect this runner to your dashboard (see the Runner setup tab).\n');
  let server = await ask('Dashboard address (e.g. https://your-app.vercel.app): ');
  if (!/^https?:\/\//i.test(server)) server = 'https://' + server;
  const token = await ask('Runner token: ');
  const name = (await ask(`Name for this PC [${os.hostname()}]: `)) || os.hostname();
  rl.close();
  const c = { server: server.replace(/\/+$/, ''), token, name };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
  return c;
}

// ---- Dashboard API --------------------------------------------------------------
async function api(p, body, contentType = 'application/json') {
  const r = await fetch(`${cfg.server}/api/runner${p}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': contentType },
    body: contentType === 'application/json' ? JSON.stringify(body || {}) : body,
  });
  if (r.status === 401) throw Object.assign(new Error('The dashboard rejected the runner token. Delete config.json in the runner folder and start again.'), { fatal: true });
  if (!r.ok) throw new Error(`Dashboard returned ${r.status}`);
  return r.json();
}

// Report progress. A brief network problem must not abort the site, so errors are only logged.
async function setJob(j, patch) {
  if (patch.note) log(`[${j.url}] ${patch.status ? patch.status + ': ' : ''}${patch.note}`);
  try { return await api(`/jobs/${j.id}`, patch); } catch (e) { if (e.fatal) throw e; log('Could not reach dashboard:', e.message); }
}

// One step of the job's record, shown in the dashboard's job details. kind: info, ok, warn, bad, person.
// The note (the job's one-line status) follows the latest step unless the patch sets its own.
function step(j, text, kind = 'info', data, patch = {}) {
  return setJob(j, { note: text, ...patch, log: { text, kind, data } });
}

// Why a pause ended, as the note the site gets when it does not continue.
const ENDED = {
  skip: 'Skipped: a team member pressed Skip',
  stop: 'Skipped: the run was stopped',
  timeout: `Skipped: nobody responded for ${HUMAN_TIMEOUT_MS / 60000} minutes`,
  closed: 'Skipped: the job was closed from the dashboard',
};

// Pause this job until a person clicks Continue or Skip in the dashboard (or the run is stopped).
// Returns 'continue', 'skip', 'stop', 'timeout' or 'closed'.
async function waitForHuman(j, page, reason) {
  await screenshot(j, page);
  await step(j, reason, 'person', undefined, { status: 'needs_help' });
  page.bringToFront().catch(() => {});
  const until = Date.now() + HUMAN_TIMEOUT_MS;
  while (Date.now() < until) {
    await sleep(2000);
    const r = await setJob(j, { takeAction: true });
    if (!r) continue;
    if (r.action === 'continue') {
      await step(j, 'A team member pressed Continue', 'person', undefined, { status: 'running' });
      return 'continue';
    }
    if (r.action) return r.action === SKIP ? 'skip' : r.action;
    if (r.status !== 'needs_help') return 'closed';
  }
  return 'timeout';
}

// The tab the person was working in: the newest open tab of this Chrome window (sites often open
// their sign-up or listing form in a new tab). Throws if every tab of the job was closed.
function latestPage(page) {
  const open = page.context().pages().filter((p) => !p.isClosed());
  if (!open.length) throw new Error('The Chrome tab for this site was closed');
  return open[open.length - 1];
}

async function hasCaptcha(page) {
  const sel = [
    'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="turnstile"]',
    'iframe[src*="challenges.cloudflare"]', '.g-recaptcha', '.h-captcha', '.cf-turnstile',
  ].join(',');
  try {
    if (await page.locator(sel).first().isVisible({ timeout: 800 })) return true;
  } catch {}
  try {
    const txt = (await page.locator('body').innerText({ timeout: 2000 })).toLowerCase();
    if (/verify you are (a )?human|are you a robot|checking your browser|complete the captcha/.test(txt)) return true;
  } catch {}
  return false;
}

async function checkpoint(j, page, where) {
  // Pause for a person if a CAPTCHA is on screen. Returns 'continue' or why the site ended.
  // A solved CAPTCHA widget usually stays on the page, so once the person clicks Continue we trust them.
  if (!(await hasCaptcha(page))) return 'continue';
  const a = await waitForHuman(j, page, `CAPTCHA at ${where}. Solve it in the open Chrome window, then click Continue.`);
  await sleep(800);
  return a;
}

// ---- Form filling -------------------------------------------------------------
// A web address for a URL field, or '' when the client's value is not one (older profiles may hold
// plain text there; the dashboard now rejects that, but such a value must never be typed into a site).
function asUrl(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { const u = new URL(v); return !/\s/.test(v) && u.hostname.includes('.') ? v : ''; } catch { return ''; }
}

function buildValues(client, account) {
  return {
    email: account.email, password: account.password, username: account.username,
    name: client.name, url: asUrl(client.url), tagline: client.tagline || client.shortDesc,
    shortDesc: client.shortDesc || client.tagline, longDesc: client.longDesc || client.shortDesc,
    keywords: client.keywords, category: client.category, phone: client.phone,
    address: client.address, city: client.city, country: client.country,
    logoUrl: asUrl(client.logoUrl), facebook: asUrl(client.facebook), twitter: asUrl(client.twitter),
    linkedin: asUrl(client.linkedin), instagram: asUrl(client.instagram),
  };
}

// Field names as shown in the job details.
const KEY_LABEL = {
  email: 'Email', password: 'Password', username: 'Username', name: 'Business name', url: 'Website', tagline: 'Tagline',
  shortDesc: 'Short description', longDesc: 'Description', keywords: 'Keywords', category: 'Category', phone: 'Phone',
  address: 'Address', city: 'City', country: 'Country', logoUrl: 'Logo URL', facebook: 'Facebook', twitter: 'Twitter / X',
  linkedin: 'LinkedIn', instagram: 'Instagram',
};
const shown = (key, v) => (key === 'password' ? '•'.repeat(10) : String(v).length > 80 ? String(v).slice(0, 77) + '...' : String(v));

function classify(info) {
  const hint = [info.name, info.id, info.ph, info.aria, info.label].join(' ').toLowerCase();
  if (info.type === 'password') return 'password';
  if (info.type === 'email' || /e-?mail/.test(hint)) return 'email';
  if (/user.?name|login|handle/.test(hint)) return 'username';
  if (/facebook/.test(hint)) return 'facebook';
  if (/twitter|x\.com/.test(hint)) return 'twitter';
  if (/linkedin/.test(hint)) return 'linkedin';
  if (/instagram/.test(hint)) return 'instagram';
  if (/logo|image.?url/.test(hint)) return 'logoUrl';
  if (info.type === 'url' || /\burl\b|website|web.?site|domain|site.?link|link/.test(hint)) return 'url';
  if (/tagline|slogan|headline/.test(hint)) return 'tagline';
  if (/short.?desc|one.?line|summary/.test(hint)) return 'shortDesc';
  if (/keyword|tags?\b/.test(hint)) return 'keywords';
  if (/phone|mobile|\btel\b/.test(hint)) return 'phone';
  if (/address|street/.test(hint)) return 'address';
  if (/\bcity\b|town/.test(hint)) return 'city';
  if (/country/.test(hint)) return 'country';
  if (info.tag === 'textarea' || /desc|about|detail|message|comment|bio|content/.test(hint)) return 'longDesc';
  if (/categor|type|industry/.test(hint)) return 'category';
  if (/name|title|business|company|brand|product|app|tool|project/.test(hint)) return 'name';
  return null;
}

const SKIP_TYPES = ['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'search', 'image', 'reset'];

// Every visible field on the page, tagged (data-bt-field / data-bt-group) so it can be found again,
// with the form it belongs to. Search boxes are marked so they are never filled.
async function scanFields(page) {
  return page.evaluate(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const forms = [...document.forms];
    return [...document.querySelectorAll('input, textarea, select')].filter(visible).map((e, i) => {
      e.setAttribute('data-bt-field', String(i));
      const form = e.closest('form');
      const hint = [e.name, e.id, e.placeholder, e.getAttribute('aria-label'), e.labels && e.labels[0] ? e.labels[0].innerText : ''].join(' ');
      const search = e.type === 'search' || !!e.closest('[role="search"], form[role="search"], form[action*="search" i]')
        || /\bsearch|\bq\b|^q$|find (a |an )?(product|business|service)|what are you looking/i.test(hint) || e.name === 'q';
      return {
        i, tag: e.tagName.toLowerCase(), type: (e.type || '').toLowerCase(), name: e.name || '', id: e.id || '',
        ph: e.placeholder || '', aria: e.getAttribute('aria-label') || '',
        label: e.labels && e.labels[0] ? e.labels[0].innerText.trim() : '', value: e.value || '',
        readOnly: !!e.readOnly || !!e.disabled, search, group: form ? forms.indexOf(form) : -1,
      };
    });
  }).catch(() => []);
}

// Fill the client's details into the page's best form: the one with the most fields we understand
// (a site's header search or newsletter box never wins over the real listing form). The chosen form is
// marked data-bt-form="1" so pressSubmit presses that form's button. Returns { count, fields, group }.
async function fillForm(page, values) {
  const infos = (await scanFields(page)).filter((f) => !SKIP_TYPES.includes(f.type) && !f.search);
  const groups = new Map();
  for (const f of infos) {
    f.key = classify(f);
    if (!f.key) continue;
    groups.set(f.group, (groups.get(f.group) || 0) + 1);
  }
  if (!groups.size) return { count: 0, fields: [], group: null };
  const group = [...groups].sort((a, b) => b[1] - a[1])[0][0];
  await page.evaluate((g) => {
    document.querySelectorAll('[data-bt-form]').forEach((e) => e.removeAttribute('data-bt-form'));
    if (g >= 0 && document.forms[g]) document.forms[g].setAttribute('data-bt-form', '1');
  }, group).catch(() => {});
  const fields = [];
  for (const f of infos) {
    if (f.group !== group || !f.key || f.readOnly || (f.value && f.tag !== 'select')) continue;
    const val = values[f.key];
    if (!val) continue;
    const el = page.locator(`[data-bt-field="${f.i}"]`);
    try {
      if (f.tag === 'select') {
        const opts = await el.evaluate((e) => [...e.options].map((o) => ({ v: o.value, t: o.text })));
        const want = String(val).toLowerCase();
        const m = opts.find((o) => o.t.trim() && (o.t.toLowerCase().includes(want) || want.includes(o.t.toLowerCase().trim())));
        if (!m) continue;
        await el.selectOption(m.v);
        fields.push({ field: f.label || f.ph || f.name || KEY_LABEL[f.key], as: KEY_LABEL[f.key], value: m.t.trim() });
      } else {
        await el.fill(String(val));
        fields.push({ field: f.label || f.ph || f.aria || f.name || KEY_LABEL[f.key], as: KEY_LABEL[f.key], value: shown(f.key, val) });
      }
    } catch {}
  }
  return { count: fields.length, fields, group };
}

async function clickByText(page, regex, scopeSel = 'a, button') {
  const items = await page.locator(scopeSel).all();
  for (const it of items) {
    try {
      if (!(await it.isVisible())) continue;
      const t = ((await it.innerText()) || (await it.getAttribute('value')) || '').trim();
      if (t && t.length < 40 && regex.test(t)) {
        await it.click({ timeout: 5000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        return t;
      }
    } catch {}
  }
  return null;
}

async function hasPasswordField(page) {
  return (await page.locator('input[type="password"]:visible').count()) > 0;
}

const SUBMIT_TEXT = /^(submit|add|list|send|save|create|register|sign ?up|post|continue|next|get started|join|publish|done|finish)\b/i;
const SEARCH_TEXT = /^(search|go|find)$/i;

// Press the submit button of the form fillForm filled (data-bt-form), falling back to a submit-looking
// button elsewhere on the page, never a search button. Returns the button's text, or null if none was found.
async function pressSubmit(page) {
  const label = async (b) => ((await b.innerText().catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim();
  const tryClick = async (sel, needsText) => {
    for (const b of await page.locator(sel).all()) {
      try {
        if (!(await b.isVisible())) continue;
        const t = await label(b);
        if (SEARCH_TEXT.test(t) || (needsText && !SUBMIT_TEXT.test(t))) continue;
        await b.click({ timeout: 5000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        return t || 'Submit';
      } catch {}
    }
    return null;
  };
  return (await tryClick('[data-bt-form] button[type="submit"], [data-bt-form] input[type="submit"], [data-bt-form] button:not([type])', false))
    || (await tryClick('[data-bt-form] button, [data-bt-form] input[type="button"], [data-bt-form] [role="button"]', true))
    || (await tryClick('button[type="submit"], input[type="submit"]', false))
    || (await tryClick('button, input[type="button"], [role="button"]', true));
}

async function bodyText(page) {
  return ((await page.locator('body').innerText().catch(() => '')) || '').toLowerCase();
}

// What the page says after Submit compared with before it, so words that were already on the page
// ("success stories" in a menu, "thank you" in a footer) never count as a confirmation.
const SUCCESS = /thank(s| you)|successfully|has been (submitted|received|added|created|listed|sent|saved|registered)|we (have )?received|submission (received|complete)|under review|pending (review|approval|moderation)|awaiting (approval|review|moderation)|listing (is )?(live|created|submitted)|registration (successful|complete)|congratulations/i;
const PROBLEM = /(is|are) required|required field|please (enter|fill|select|provide|correct|check)|invalid|not valid|already (exists|registered|taken|in use)|error|failed|try again|incorrect/i;
const OTP = /\botp\b|one.?time (password|code)|verification code|enter (the )?code|code (has been |was )?sent/i;
async function pageState(page) {
  return { url: page.url(), text: (await page.locator('body').innerText().catch(() => '')) || '' };
}
function newMatch(before, after, re) {
  const lines = after.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const old = new Set(before.text.split(/\n+/).map((l) => l.trim()));
  const line = lines.find((l) => re.test(l) && !old.has(l) && l.length < 300);
  return line ? line.slice(0, 160) : null;
}
function submitOutcome(before, after) {
  const moved = after.url !== before.url;
  const success = newMatch(before, after, SUCCESS);
  if (success) return { result: 'success', evidence: `The site showed: "${success}"` };
  if (moved && /thank|success|confirm|submitted|complete|done|received/i.test(new URL(after.url).pathname + new URL(after.url).search)) {
    return { result: 'success', evidence: `The site moved to a confirmation page: ${after.url}` };
  }
  const otp = newMatch(before, after, OTP);
  if (otp) return { result: 'otp', evidence: `The site asks for a code: "${otp}"` };
  const problem = newMatch(before, after, PROBLEM);
  if (problem) return { result: 'problem', evidence: `The site showed: "${problem}"` };
  return { result: 'unknown', evidence: moved ? `The site moved to ${after.url} without a confirmation message` : 'The page did not change after Submit' };
}

async function screenshot(j, page) {
  try {
    const img = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: true });
    await api(`/jobs/${j.id}/shot`, img, 'image/jpeg');
  } catch (e) { if (e.fatal) throw e; }
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let p = '';
  for (const b of crypto.randomBytes(14)) p += chars[b % chars.length];
  return p + '!7a';
}

// ---- Finding the listing page ---------------------------------------------------
// Link text and addresses that usually lead to the page where a site takes new listings.
const SUBMIT_LINK = /submit|add (a |an |your |new )?(site|website|listing|url|link|product|tool|startup|business|app|company|saas|software|service|resource)|list (your|my) |get listed|suggest (a |an )?(site|website|tool|link|product|startup|resource)|new listing|create (a )?listing|free listing|basic listing|claim (your )?(listing|business)|sell on|start selling|become a (seller|supplier|vendor)|join as (a )?(business|seller|supplier|vendor)|register (your |as a )?(business|seller|supplier)/i;
const SUBMIT_PATH = /submit|add[-_]?((your|a|new)[-_]?)?(site|website|url|link|listing|business|product|tool|startup|company|app)|addurl|list[-_]?your|get[-_]?listed|suggest[-_]((a|an|your|new)[-_])?(site|website|link|url|tool|listing|business|resource|startup|product|company)|new[-_]?listing|listings?\/(new|add|create)|create[-_]?listing|free[-_]?listing|sell[-_]?on|seller[-_]?(registration|signup|sign-up|register|join)|become[-_]?a[-_]?(seller|supplier|vendor|partner)|join[-_]?as|register[-_]?(your[-_]?)?(business|company)|business[-_]?(registration|signup|sign-up)|claim[-_]?(your[-_]?)?(business|listing)/i;
const NOT_SUBMIT = /log ?in|log ?out|sign ?in|newsletter|subscribe|ticket|review|comment|feedback|report|careers|privacy|terms|cookie|contact/i;
const COMMON_SUBMIT_PATHS = [
  '/submit', '/submit-site', '/submit-website', '/submit-listing', '/submit-tool', '/submit-startup', '/submit-product',
  '/add', '/add-site', '/add-listing', '/add-your-site', '/add-business', '/add-url', '/addurl', '/suggest',
  '/list-your-business', '/get-listed', '/listing/add', '/listings/new', '/new-listing', '/submit.php', '/add.php',
];
const siteBase = (h) => h.replace(/^www\./, '').split('.').slice(-2).join('.');

// What the open page is: 'form' (a listing form with a website field), 'maybe' (a form without one,
// e.g. a contact form), 'login' (a login or sign-up wall), 'start' (just a mobile number or email box,
// the first step of many sign-ups that continue with an OTP), or null.
async function pageKind(page) {
  if (await hasPasswordField(page)) return 'login';
  const infos = await scanFields(page);
  const keys = infos.filter((i) => !SKIP_TYPES.includes(i.type) && !i.readOnly && !i.search).map(classify).filter(Boolean);
  if (keys.length < 3) return keys.includes('phone') || keys.includes('email') ? 'start' : null;
  return keys.includes('url') ? 'form' : 'maybe';
}

// Same-site links on the open page (menus and footers included, even when hidden), best match first.
async function submitLinks(page, tried) {
  const here = new URL(page.url());
  const links = await page.$$eval('a[href]', (as) => as.map((a) => ({
    href: a.href, text: (a.innerText || a.getAttribute('aria-label') || a.title || a.textContent || '').trim().slice(0, 80),
  }))).catch(() => []);
  const out = new Map();
  for (const l of links) {
    let u;
    try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || siteBase(u.hostname) !== siteBase(here.hostname)) continue;
    u.hash = '';
    if (tried.has(u.href)) continue;
    const where = u.pathname + u.search;
    let score = (SUBMIT_LINK.test(l.text) ? 3 : 0) + (SUBMIT_PATH.test(where) ? 2 : 0);
    if (!score) continue;
    if (NOT_SUBMIT.test(l.text) || NOT_SUBMIT.test(where)) score -= 4;
    if (score > 0 && score > (out.get(u.href) || 0)) out.set(u.href, score);
  }
  return [...out].sort((a, b) => b[1] - a[1]).map(([url]) => url);
}

// Fetch a file without opening it in the tab (sitemaps may be gzipped: .xml.gz).
async function fetchText(page, url) {
  try {
    const r = await page.request.get(url, { timeout: 15000 });
    if (!r.ok()) return null;
    let body = await r.body();
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    return body.toString('utf8');
  } catch { return null; }
}

// Page addresses from the site's sitemaps that look like submit pages, best first. Sitemaps are taken from
// robots.txt and the usual sitemap addresses; sitemap indexes are followed, page sitemaps before post/product ones.
async function sitemapSubmitUrls(page, origin, tried) {
  const queue = [];
  const robots = await fetchText(page, origin + '/robots.txt');
  if (robots) for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1]);
  queue.push(...['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap/sitemap.xml', '/sitemap.xml.gz'].map((p) => origin + p));
  const childRank = (u) => (/page|main|static|general|misc|core/i.test(u) ? 0 : /post|product|blog|news|categor|tag|author|image|video|city|location|search/i.test(u) ? 2 : 1);
  const seen = new Set();
  const found = new Map();
  for (let fetched = 0; queue.length && fetched < 15 && found.size < 5; ) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    fetched++;
    const xml = await fetchText(page, sm);
    if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue;
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(xml)) {
      queue.push(...locs.sort((a, b) => childRank(a) - childRank(b)));
      queue.sort((a, b) => childRank(a) - childRank(b));
      continue;
    }
    for (const loc of locs) {
      let u;
      try { u = new URL(loc); } catch { continue; }
      if (siteBase(u.hostname) !== siteBase(new URL(origin).hostname) || tried.has(u.href)) continue;
      if (!SUBMIT_PATH.test(u.pathname) || NOT_SUBMIT.test(u.pathname)) continue;
      // Long slugs are articles about listing ("how-to-list-your-business-online"), not the submit page itself.
      if ((u.pathname.split('/').filter(Boolean).pop() || '').split(/[-_]/).length > 5) continue;
      // Submit pages sit near the top of a site; deep addresses are usually listings that merely contain the word.
      found.set(u.href, u.pathname.split('/').filter(Boolean).length);
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]).map(([url]) => url).slice(0, 5);
}

// The usual submit addresses, kept only when the server answers with a page that has a form or a login on it.
async function guessedSubmitUrls(page, origin, tried) {
  const found = [];
  for (const u of COMMON_SUBMIT_PATHS.map((p) => origin + p).filter((x) => !tried.has(x))) {
    try {
      const r = await page.request.get(u, { timeout: 8000 });
      // The site is rate-limiting or blocking us: stop guessing before it blocks the real pages too.
      if (r.status() === 429 || r.status() === 403) break;
      if (r.ok() && /<form|<input|<textarea|log ?in|sign ?in/i.test(await r.text())) found.push(u);
    } catch {}
    if (found.length >= 4) break;
    await sleep(400);
  }
  return found;
}

// Open a page and say what it is. Many forms are drawn by JavaScript after the page loads, so look twice.
// Pages are opened at a person's pace: big sites answer quick page after page with 429 Too Many Requests.
async function openAndCheck(page, url) {
  await sleep(1500);
  try {
    let res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (res && res.status() === 429) {
      await sleep(20000);
      res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (res && res.status() === 429) return null;
    }
  } catch { return null; }
  let kind = await pageKind(page);
  if (!kind) { await sleep(2500); kind = await pageKind(page); }
  return kind;
}

// Find where this site takes new listings and leave Chrome on that page. The site itself is searched first
// (a form on the page, its links, its buttons), then its sitemap, then the usual submit addresses.
// Returns { url, kind, via } with kind 'form', 'login' (the listing page needs an account), 'maybe' or 'start', or null.
async function findSubmitPage(j, page) {
  await step(j, 'Looking for where the site can be listed');
  const start = page.url();
  if ((await pageKind(page)) === 'form') return { url: start, kind: 'form', via: 'the opened page' };
  const origin = new URL(start).origin;
  const tried = new Set([start]);
  // Weaker matches, used only if nothing better turns up: a form without a website field beats a mobile-number box.
  let fallback = null;
  const visit = async (url, via) => {
    tried.add(url);
    const kind = await openAndCheck(page, url);
    if (kind === 'form' || kind === 'login') return { url, kind, via };
    if ((kind === 'maybe' && fallback?.kind !== 'maybe') || (kind === 'start' && !fallback)) fallback = { url, kind, via };
    return null;
  };

  // 1) Links on the start page, then one step further from the best of them (e.g. a plan page with "Free listing").
  const links = (await submitLinks(page, tried)).slice(0, 6);
  for (const u of links) { const r = await visit(u, 'a link on the site'); if (r) return r; }
  if (links[0]) {
    await openAndCheck(page, links[0]);
    for (const u of (await submitLinks(page, tried)).slice(0, 3)) { const r = await visit(u, 'a link on the site'); if (r) return r; }
  }
  // 2) A button on the start page that opens the form without a link (pop-ups, JavaScript menus).
  await openAndCheck(page, start);
  if (await clickByText(page, SUBMIT_LINK, 'button, [role="button"]')) {
    await sleep(1500);
    const kind = await pageKind(page);
    if (kind === 'form' || kind === 'login') return { url: page.url(), kind, via: 'a button on the site' };
  }
  // 3) The sitemap.
  await step(j, 'No listing link or button on the site, checking its sitemap');
  for (const u of await sitemapSubmitUrls(page, origin, tried)) { const r = await visit(u, 'the sitemap'); if (r) return r; }
  // 4) The usual submit addresses.
  for (const u of await guessedSubmitUrls(page, origin, tried)) { const r = await visit(u, 'a common submit address'); if (r) return r; }
  if (fallback && (await openAndCheck(page, fallback.url))) return fallback;
  await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  return null;
}

const who = (acct) => acct.email || acct.username || 'the saved account';

// Log in with a saved account. Returns 'ok', 'none' (no login form here) or why the site ended.
// A login only counts as working when the password box is gone afterwards.
async function logIn(j, page, client, acct) {
  if (!(await hasPasswordField(page))) await clickByText(page, /^(log ?in|sign ?in)\b/i);
  if (!(await hasPasswordField(page))) return 'none';
  await step(j, `Logging in as ${who(acct)}`);
  const before = await pageState(page);
  await fillForm(page, buildValues(client, acct));
  await pressSubmit(page);
  await sleep(2500);
  const cp = await checkpoint(j, page, 'login');
  if (cp !== 'continue') return cp;
  if (!(await hasPasswordField(page))) { await step(j, `Logged in as ${who(acct)}`, 'ok'); return 'ok'; }
  const problem = newMatch(before, await pageState(page), PROBLEM);
  await step(j, `Login did not work${problem ? `: the site showed "${problem}"` : ' (the login form is still showing)'}`, 'warn');
  const a = await waitForHuman(j, page, `Login as ${who(acct)} did not work. Log in yourself in Chrome (or reset the password), then click Continue.`);
  return a === 'continue' ? 'ok' : a;
}

// Create an account if the site offers sign-up. Returns the new account, null (no sign-up form),
// or why the site ended (a string). The result of the sign-up is checked and recorded.
async function signUp(j, page, client) {
  // On a login page, look for a sign-up link (links only, so a "Sign up" submit button is never pressed early).
  const scope = (await hasPasswordField(page)) ? 'a' : 'a, button';
  const clicked = await clickByText(page, /sign ?up|register|create (an |your )?account|join( now| free)?/i, scope);
  if (!clicked) {
    if (scope === 'a, button') return null;
    // Already on a page with a password field: only treat it as sign-up if it looks like one, not a login form.
    const twoPasswords = (await page.locator('input[type="password"]:visible').count()) > 1;
    if (!twoPasswords && !/sign ?up|register|create (an |your )?account/.test(await bodyText(page))) return null;
  }
  if (!(await hasPasswordField(page))) return null;
  if (!client.email) {
    await step(j, 'This site needs an account, but the client has no sign-up email', 'warn');
    return null;
  }

  const acct = {
    email: client.email,
    password: genPassword(),
    username: (client.name || 'client').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) + crypto.randomBytes(2).toString('hex').slice(0, 3),
  };
  // Saved before submitting, so the password is never lost even if the page crashes after sign-up.
  await api('/accounts', { clientId: j.clientId, url: j.url, ...acct });
  await step(j, `Signing up as ${acct.email} (username ${acct.username}); the account is saved for this site`);
  const before = await pageState(page);
  const f = await fillForm(page, buildValues(client, acct));
  await step(j, `Filled ${f.count} sign-up field(s)`, 'info', { fields: f.fields });
  if (j.reviewMode) {
    const a = await waitForHuman(j, page, 'Review the sign-up form (fix anything, solve any CAPTCHA), then click Continue to submit it.');
    if (a !== 'continue') return a;
  }
  await pressSubmit(page);
  await sleep(3000);
  const cp = await checkpoint(j, page, 'sign-up');
  if (cp !== 'continue') return cp;
  const after = await pageState(page);
  const verify = newMatch(before, after, /verif|confirm.{0,20}e-?mail|check your (e-?)?mail|activation|\botp\b|verification code/i);
  if (verify) {
    await step(j, `Sign-up needs verification: the site showed "${verify}"`, 'warn');
    const a = await waitForHuman(j, page, `Verification needed for ${acct.email} ("${verify}"). Open the email or SMS, finish the verification (in this Chrome window if possible), then click Continue.`);
    if (a !== 'continue') return a;
    // Verification usually ends logged out, so start again from the site and log in.
    await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const r = await logIn(j, page, client, acct);
    if (!['ok', 'none'].includes(r)) return r;
  } else if (await hasPasswordField(page)) {
    const problem = newMatch(before, after, PROBLEM);
    await step(j, `Sign-up did not seem to work${problem ? `: the site showed "${problem}"` : ' (the form is still showing)'}`, 'warn');
    const a = await waitForHuman(j, page, `Sign-up as ${acct.email} did not seem to work${problem ? ` ("${problem}")` : ''}. Fix it in Chrome (or log in if the account already exists), then click Continue.`);
    if (a !== 'continue') return a;
  } else {
    await step(j, `Signed up as ${acct.email}`, 'ok');
  }
  return acct;
}

// Browser errors in words a team member can act on (the original stays in brackets).
function plainError(m) {
  const known = [
    [/ERR_NAME_NOT_RESOLVED/, 'this web address does not exist (check the site URL in the Sites tab)'],
    [/ERR_CERT|SSL|certificate/i, 'the site\'s security certificate is broken, so Chrome will not open it'],
    [/ERR_CONNECTION_(REFUSED|RESET|CLOSED)|ERR_EMPTY_RESPONSE/, 'the site refused the connection or is down'],
    [/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/, 'this PC lost its internet connection'],
    [/Timeout \d+ms exceeded|timed? ?out/i, 'the site took too long to load'],
    [/Target (page, context or browser )?(has been )?closed|tab for this site was closed|Browser has been closed/i, 'the Chrome window or tab was closed during the job'],
  ];
  const hit = known.find(([re]) => re.test(m));
  return hit ? `${hit[1]} (${m.slice(0, 120)})` : m;
}

// ---- One site -----------------------------------------------------------------
async function processJob(ctx, { job: j, client, account }) {
  let acct = account;
  // Every way a site can end without a result says why, in the note and the job's record.
  const ended = (a) => { const text = ENDED[a] || ENDED.closed; return setJob(j, { status: 'skipped', note: text, log: { text, kind: 'warn' } }); };
  let page = await ctx.newPage();
  // Heartbeat so the dashboard knows this runner is still alive during long steps.
  const beat = setInterval(() => api(`/jobs/${j.id}`, {}).catch(() => {}), 15000);
  let a;
  try {
    await step(j, `Opening ${j.url}`, 'info', undefined, { status: 'running' });
    const res = await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await step(j, `Opened "${((await page.title().catch(() => '')) || page.url()).slice(0, 90)}"${res ? ` (HTTP ${res.status()})` : ''}`);
    if ((a = await checkpoint(j, page, 'landing page')) !== 'continue') return ended(a);

    // 1) A saved account: log in now, so member-only listing links show up.
    if (acct) {
      const r = await logIn(j, page, client, acct);
      if (!['ok', 'none'].includes(r)) return ended(r);
      if (r === 'none') await step(j, `Saved account ${who(acct)}: no login form on this page, will log in if the listing page asks`);
    }

    // 2) Find the listing page: the one saved for this site, otherwise search the site.
    let target = null;
    if (j.submitUrl) {
      const kind = await openAndCheck(page, j.submitUrl);
      if (kind) target = { url: j.submitUrl, kind, via: 'the page saved for this site' };
      else await step(j, `The saved listing page ${j.submitUrl} shows no form now; searching the site again`, 'warn');
    }
    if (!target) target = await findSubmitPage(j, page);
    if (target) await step(j, `Listing page found via ${target.via}: ${target.url}`, 'ok', { kind: target.kind });
    else await step(j, 'No listing page found automatically (checked links, buttons, sitemap and the usual submit addresses)', 'warn');
    // The listing page may sit behind a login, or the site may show its submit link only to members:
    // sign up or log in, then go back to the listing page (or search again).
    if ((await hasPasswordField(page)) || (!target && !acct)) {
      if (!(await hasPasswordField(page))) await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (acct) {
        const r = await logIn(j, page, client, acct);
        if (!['ok', 'none'].includes(r)) return ended(r);
      } else {
        const r = await signUp(j, page, client);
        if (typeof r === 'string') return ended(r);
        if (r) acct = r;
        else await step(j, 'The site offers no sign-up form here');
      }
      if (target) {
        if (page.url() !== target.url) await openAndCheck(page, target.url);
      } else if (acct) {
        target = await findSubmitPage(j, page);
        if (target) await step(j, `Listing page found via ${target.via}: ${target.url}`, 'ok', { kind: target.kind });
      }
    }

    let byPerson = false; // the person opened the listing page themselves
    // Mobile-number (OTP) sign-ups need a person: put the number in, then let them finish in Chrome.
    if (target && (await pageKind(page)) === 'start') {
      const f = await fillForm(page, buildValues(client, acct || { email: client.email }));
      await step(j, `This site starts with a mobile number or email sign-up; filled ${f.count} field(s)`, 'info', { fields: f.fields });
      await setJob(j, { submitUrl: target.url });
      if ((a = await waitForHuman(j, page, 'This site lists businesses after a mobile number or email sign-up with an OTP. Finish the sign-up in Chrome and open the business details form, then click Continue.')) !== 'continue') return ended(a);
      page = latestPage(page);
      byPerson = true;
    }
    if ((a = await checkpoint(j, page, 'submission page')) !== 'continue') return ended(a);
    if (await hasPasswordField(page)) {
      if ((a = await waitForHuman(j, page, 'Still on a login or sign-up page. Log in or open the submit form in Chrome, then click Continue.')) !== 'continue') return ended(a);
      page = latestPage(page);
      byPerson = true;
    }

    // 3) Fill the form.
    const values = buildValues(client, acct || { email: client.email });
    let f = await fillForm(page, values);
    if (!f.count) {
      // Many sites draw their form with JavaScript after the page loads; give it a moment.
      await sleep(4000);
      f = await fillForm(page, values);
    }
    if (!f.count) {
      const why = target ? `The listing page has no form I understand (${page.url()}).` : 'Could not find where this site takes listings (checked its links, buttons, sitemap and the usual submit addresses).';
      if ((a = await waitForHuman(j, page, `${why} In Chrome, open the page where the business details are entered (in any tab), then click Continue. That page will be remembered for this site.`)) !== 'continue') return ended(a);
      page = latestPage(page);
      byPerson = true;
      f = await fillForm(page, values);
    }
    if (f.count) await step(j, `Filled ${f.count} field(s) on ${page.url()}`, 'ok', { fields: f.fields });
    // Remember the listing page so the next run goes straight to it: the page the search found,
    // or the page the person opened (only if it has a form, so a product or search page is never saved).
    const saveUrl = byPerson ? page.url() : target && target.url;
    if (saveUrl && saveUrl !== j.submitUrl && (f.count || ['form', 'maybe', 'start'].includes(await pageKind(page)))) {
      await setJob(j, { submitUrl: saveUrl, log: { text: `Saved ${saveUrl} as this site's listing page`, kind: 'info' } });
    }
    if (!f.count) {
      await screenshot(j, page);
      const text = 'Not submitted: no field on this page matched the client\'s details. If you filled and submitted it yourself in Chrome, check the listing; otherwise set the listing page in the Sites tab.';
      return setJob(j, { status: 'unconfirmed', note: text, log: { text, kind: 'bad' } });
    }

    // 4) Submit and check what the site says.
    let before = await pageState(page);
    let pressed = null;
    if (j.reviewMode) {
      if ((a = await waitForHuman(j, page, `Filled ${f.count} field(s) (see the job details). Review the form in Chrome, then click Continue to press Submit, or press Submit yourself first.`)) !== 'continue') return ended(a);
      page = latestPage(page);
      // The person may have pressed Submit already: the form we filled is gone, so do not press anything else.
      if (!(await page.locator('[data-bt-field]').count().catch(() => 0))) pressed = 'pressed by the team member';
      else before = await pageState(page);
    }
    if (!pressed) {
      pressed = await pressSubmit(page);
      if (!pressed) {
        await step(j, 'Could not find the Submit button', 'warn');
        if ((a = await waitForHuman(j, page, 'Could not find the Submit button. Press it yourself in Chrome, then click Continue.')) !== 'continue') return ended(a);
        page = latestPage(page);
        pressed = 'pressed by the team member';
      }
    }
    await step(j, `Submit ${pressed.startsWith('pressed by') ? pressed : `pressed ("${pressed}")`}`);
    await sleep(3500);
    if ((a = await checkpoint(j, page, 'submit')) !== 'continue') return ended(a);
    let out = submitOutcome(before, await pageState(page));
    if (out.result === 'otp') {
      if ((a = await waitForHuman(j, page, `${out.evidence}. Enter the code in Chrome and finish the submission, then click Continue.`)) !== 'continue') return ended(a);
      page = latestPage(page);
      out = submitOutcome(before, await pageState(page));
      if (out.result === 'otp') out = { result: 'unknown', evidence: 'The site still shows the code step' };
    }
    await screenshot(j, page);
    if (out.result === 'success') {
      const text = `Submitted (${f.count} fields filled). ${out.evidence}`;
      await setJob(j, { status: 'submitted', note: text, log: { text, kind: 'ok' } });
    } else {
      const text = `Not confirmed (${f.count} fields filled). ${/[.!?"]$/.test(out.evidence) ? out.evidence : out.evidence + '.'} Check the screenshot and the site.`;
      await setJob(j, { status: 'unconfirmed', note: text, log: { text, kind: out.result === 'problem' ? 'bad' : 'warn' } });
    }
  } catch (e) {
    if (e.fatal) throw e;
    const text = `Failed: ${plainError(String(e.message || e).split('\n')[0])}`;
    await setJob(j, { status: 'failed', note: text, log: { text, kind: 'bad' } });
  } finally {
    clearInterval(beat);
    await page.close().catch(() => {});
  }
}

// ---- Main loop ----------------------------------------------------------------
async function main() {
  cfg = await loadConfig();
  log(`Runner "${cfg.name}" connected to ${cfg.server}. Waiting for sites to be queued in the dashboard.`);
  log('Keep this window open. Close it to stop the runner.');
  let ctx = null;
  let idleSince = Date.now();
  for (;;) {
    let claim;
    try {
      claim = await api('/claim', { name: cfg.name });
    } catch (e) {
      if (e.fatal) { log(e.message); process.exit(1); }
      log('Cannot reach the dashboard:', e.message, '- retrying.');
      await sleep(10000);
      continue;
    }
    if (!claim.job) {
      if (ctx && Date.now() - idleSince > CLOSE_CHROME_AFTER_IDLE_MS) { await ctx.close().catch(() => {}); ctx = null; }
      await sleep(IDLE_POLL_MS);
      continue;
    }
    if (!ctx) {
      try {
        ctx = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless: false, viewport: null, args: ['--start-maximized'] });
        ctx.on('close', () => { ctx = null; }); // the person closed Chrome: open it again for the next site
      } catch (e) {
        await setJob(claim.job, { status: 'failed', note: 'Could not start Chrome: ' + String(e.message).split('\n')[0] });
        await sleep(IDLE_POLL_MS);
        continue;
      }
    }
    try {
      await processJob(ctx, claim); // strictly one site at a time
    } catch (e) {
      if (e.fatal) { log(e.message); process.exit(1); }
      log('Error:', e.message);
    }
    idleSince = Date.now();
  }
}

main();
