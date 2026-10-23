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

// Pause this job until a person clicks Continue or Skip in the dashboard.
async function waitForHuman(j, page, reason) {
  await setJob(j, { status: 'needs_help', note: reason });
  page.bringToFront().catch(() => {});
  const until = Date.now() + HUMAN_TIMEOUT_MS;
  while (Date.now() < until) {
    await sleep(2000);
    const r = await setJob(j, { takeAction: true });
    if (!r) continue;
    if (r.action) {
      if (r.action !== SKIP) await setJob(j, { status: 'running', note: 'Continuing' });
      return r.action;
    }
    if (r.status !== 'needs_help') return SKIP; // closed from the dashboard
  }
  return SKIP;
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
  // Pause for a person if a CAPTCHA is on screen. Returns false if the person skipped the site.
  // A solved CAPTCHA widget usually stays on the page, so once the person clicks Continue we trust them.
  if (!(await hasCaptcha(page))) return true;
  const a = await waitForHuman(j, page, `CAPTCHA at ${where}. Solve it in the open Chrome window, then click Continue.`);
  await sleep(800);
  return a !== SKIP;
}

// ---- Form filling -------------------------------------------------------------
function buildValues(client, account) {
  return {
    email: account.email, password: account.password, username: account.username,
    name: client.name, url: client.url, tagline: client.tagline || client.shortDesc,
    shortDesc: client.shortDesc || client.tagline, longDesc: client.longDesc || client.shortDesc,
    keywords: client.keywords, category: client.category, phone: client.phone,
    address: client.address, city: client.city, country: client.country,
    logoUrl: client.logoUrl, facebook: client.facebook, twitter: client.twitter,
    linkedin: client.linkedin, instagram: client.instagram,
  };
}

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

async function fillForm(page, values) {
  let filled = 0;
  const els = await page.locator('input:visible, textarea:visible, select:visible').all();
  for (const el of els) {
    let info;
    try {
      info = await el.evaluate((e) => ({
        tag: e.tagName.toLowerCase(), type: (e.type || '').toLowerCase(), name: e.name || '', id: e.id || '',
        ph: e.placeholder || '', aria: e.getAttribute('aria-label') || '',
        label: e.labels && e.labels[0] ? e.labels[0].innerText : '', value: e.value || '',
        readOnly: !!e.readOnly || !!e.disabled,
      }));
    } catch { continue; }
    if (SKIP_TYPES.includes(info.type)) continue;
    if (info.readOnly || (info.value && info.tag !== 'select')) continue;
    const key = classify(info);
    const val = key && values[key];
    if (!val) continue;
    try {
      if (info.tag === 'select') {
        const opts = await el.evaluate((e) => [...e.options].map((o) => ({ v: o.value, t: o.text })));
        const want = String(val).toLowerCase();
        const m = opts.find((o) => o.t.toLowerCase().includes(want) || want.includes(o.t.toLowerCase().trim()) && o.t.trim());
        if (m) { await el.selectOption(m.v); filled++; }
      } else {
        await el.fill(String(val));
        filled++;
      }
    } catch {}
  }
  return filled;
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

async function pressSubmit(page) {
  const direct = page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
  try {
    if (await direct.count()) { await direct.click({ timeout: 5000 }); return true; }
  } catch {}
  return !!(await clickByText(page, /^(submit|add|list|send|save|create|register|sign ?up|post|continue|next)\b/i, 'button, input[type="button"]'));
}

async function bodyText(page) {
  return ((await page.locator('body').innerText().catch(() => '')) || '').toLowerCase();
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
  const infos = await page.$$eval('input, textarea, select', (els) => els
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .map((e) => ({
      tag: e.tagName.toLowerCase(), type: (e.type || '').toLowerCase(), name: e.name || '', id: e.id || '',
      ph: e.placeholder || '', aria: e.getAttribute('aria-label') || '',
      label: e.labels && e.labels[0] ? e.labels[0].innerText : '', readOnly: !!e.readOnly || !!e.disabled,
    }))).catch(() => []);
  const keys = infos.filter((i) => !SKIP_TYPES.includes(i.type) && !i.readOnly).map(classify).filter(Boolean);
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
  await setJob(j, { note: 'Looking for where the site can be listed' });
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
  await setJob(j, { note: 'No listing link on the site, checking its sitemap' });
  for (const u of await sitemapSubmitUrls(page, origin, tried)) { const r = await visit(u, 'the sitemap'); if (r) return r; }
  // 4) The usual submit addresses.
  for (const u of await guessedSubmitUrls(page, origin, tried)) { const r = await visit(u, 'a common submit address'); if (r) return r; }
  if (fallback && (await openAndCheck(page, fallback.url))) return fallback;
  await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  return null;
}

// Log in with a saved account. Returns SKIP if the person skipped the site.
async function logIn(j, page, client, acct) {
  await setJob(j, { note: 'Logging in with saved account' });
  if (!(await hasPasswordField(page))) await clickByText(page, /log ?in|sign ?in/i);
  if (!(await hasPasswordField(page))) return;
  await fillForm(page, buildValues(client, acct));
  await pressSubmit(page);
  await sleep(2500);
  if (!(await checkpoint(j, page, 'login'))) return SKIP;
}

// Create an account if the site offers sign-up. Returns the new account, SKIP, or nothing.
async function signUp(j, page, client) {
  // On a login page, look for a sign-up link (links only, so a "Sign up" submit button is never pressed early).
  const scope = (await hasPasswordField(page)) ? 'a' : 'a, button';
  const clicked = await clickByText(page, /sign ?up|register|create (an |your )?account|join( now| free)?/i, scope);
  if (!clicked) {
    if (scope === 'a, button') return;
    // Already on a page with a password field: only treat it as sign-up if it looks like one, not a login form.
    const twoPasswords = (await page.locator('input[type="password"]:visible').count()) > 1;
    if (!twoPasswords && !/sign ?up|register|create (an |your )?account/.test(await bodyText(page))) return;
  }
  if (!(await hasPasswordField(page))) return;

  await setJob(j, { note: 'Signing up' });
  const acct = {
    email: client.email,
    password: genPassword(),
    username: (client.name || 'client').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) + crypto.randomBytes(2).toString('hex').slice(0, 3),
  };
  // Saved before submitting, so the password is never lost even if the page crashes after sign-up.
  await api('/accounts', { clientId: j.clientId, url: j.url, ...acct });
  await fillForm(page, buildValues(client, acct));
  if (j.reviewMode) {
    const a = await waitForHuman(j, page, 'Review the sign-up form (fix anything, solve any CAPTCHA), then click Continue to submit it.');
    if (a === SKIP) return SKIP;
  }
  await pressSubmit(page);
  await sleep(3000);
  if (!(await checkpoint(j, page, 'sign-up'))) return SKIP;
  if (/verif|confirm.{0,20}e-?mail|check your (e-?)?mail|activation/.test(await bodyText(page))) {
    const a = await waitForHuman(j, page, `Email verification needed for ${acct.email}. Open the verification email, click its link (in this Chrome window if possible), then click Continue.`);
    if (a === SKIP) return SKIP;
    // Verification usually ends logged out, so start again from the site and log in.
    await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if ((await logIn(j, page, client, acct)) === SKIP) return SKIP;
  }
  return acct;
}

// ---- One site -----------------------------------------------------------------
async function processJob(ctx, { job: j, client, account }) {
  let acct = account;
  const skipped = (note = 'Skipped by user') => setJob(j, { status: 'skipped', note });

  await setJob(j, { status: 'running', note: 'Opening site' });
  const page = await ctx.newPage();
  // Heartbeat so the dashboard knows this runner is still alive during long steps.
  const beat = setInterval(() => api(`/jobs/${j.id}`, {}).catch(() => {}), 30000);
  try {
    await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!(await checkpoint(j, page, 'landing page'))) return skipped();

    // 1) Account: log in if we have one, otherwise sign up when the site offers it.
    if (acct) {
      if ((await logIn(j, page, client, acct)) === SKIP) return skipped();
    } else {
      const r = await signUp(j, page, client);
      if (r === SKIP) return skipped();
      if (r) acct = r;
    }

    // 2) Find the listing page: the one saved from an earlier run, otherwise search the site.
    let target = null;
    if (j.submitUrl) {
      const kind = await openAndCheck(page, j.submitUrl);
      if (kind) target = { url: j.submitUrl, kind, via: 'the page saved from an earlier run' };
    }
    if (!target) target = await findSubmitPage(j, page);
    // The listing page may sit behind a login, or the site may show its submit link only to members:
    // sign up or log in, then go back to the listing page (or search again).
    if ((await hasPasswordField(page)) || (!target && !acct)) {
      if (!(await hasPasswordField(page))) await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (acct) {
        if ((await logIn(j, page, client, acct)) === SKIP) return skipped();
      } else {
        const r = await signUp(j, page, client);
        if (r === SKIP) return skipped();
        if (r) acct = r;
      }
      if (target) {
        if (page.url() !== target.url) await openAndCheck(page, target.url);
      } else if (acct) {
        target = await findSubmitPage(j, page);
      }
    }
    if (target) await setJob(j, { note: `Listing page${target.via ? ` (found via ${target.via})` : ''}: ${page.url()}` });
    // Mobile-number (OTP) sign-ups need a person: put the number in, then let them finish in Chrome.
    if (target && (await pageKind(page)) === 'start') {
      await fillForm(page, buildValues(client, acct || { email: client.email }));
      await setJob(j, { submitUrl: target.url });
      const a = await waitForHuman(j, page, 'This site lists businesses after a mobile number or email sign-up with an OTP. Finish the sign-up in Chrome and open the business details form, then click Continue.');
      if (a === SKIP) return skipped();
    }
    if (!(await checkpoint(j, page, 'submission page'))) return skipped();
    if (await hasPasswordField(page)) {
      const a = await waitForHuman(j, page, 'Still on a login or sign-up page. Log in or open the submit form in Chrome, then click Continue.');
      if (a === SKIP) return skipped();
    }

    // 3) Fill the form.
    await setJob(j, { note: 'Filling form' });
    const values = buildValues(client, acct || { email: client.email });
    let filled = await fillForm(page, values);
    if (filled === 0) {
      // Many sites draw their form with JavaScript after the page loads; give it a moment.
      await sleep(4000);
      filled = await fillForm(page, values);
    }
    if (filled === 0) {
      const why = target ? 'Could not find a form I understand.' : 'Could not find where this site takes listings (checked its links, sitemap and the usual submit addresses).';
      const a = await waitForHuman(j, page, `${why} Open the submit form in Chrome (fill it if you like), then click Continue. The page will be remembered for next time.`);
      if (a === SKIP) return skipped();
      filled = await fillForm(page, values);
    }
    // Remember the listing page so the next run for this site goes straight to it.
    if (filled > 0 || ['form', 'maybe'].includes(await pageKind(page))) await setJob(j, { submitUrl: page.url() });

    if (j.reviewMode) {
      await screenshot(j, page);
      const a = await waitForHuman(j, page, `Filled ${filled} field(s). Review the form, then click Continue to let the tool press Submit (or press Submit yourself first).`);
      if (a === SKIP) return skipped();
    }
    await pressSubmit(page);
    await sleep(3000);
    if (!(await checkpoint(j, page, 'submit'))) return skipped();
    await screenshot(j, page);
    if (/thank|received|submitted|success|under review|pending (review|approval)|has been (added|created|listed|sent)/.test(await bodyText(page))) {
      await setJob(j, { status: 'submitted', note: `Submitted (${filled} fields filled). Check the listing goes live.` });
    } else {
      await setJob(j, { status: 'unconfirmed', note: `Pressed Submit (${filled} fields filled) but the site showed no confirmation. Check the screenshot.` });
    }
  } catch (e) {
    if (e.fatal) throw e;
    await setJob(j, { status: 'failed', note: String(e.message || e).split('\n')[0] });
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
