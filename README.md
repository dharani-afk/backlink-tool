# Backlink Tool

Agency backlink submission tool. Store each client's details and documents, keep a list of target sites, and work through the sites **one at a time in a visible Chrome window**. The tool signs up (or logs in), finds the submit form and fills in the client's details. A person steps in for CAPTCHAs and email verification.

## How it fits together

- **Website (Next.js on Vercel):** the dashboard and API. It holds clients, sites, saved site accounts (passwords encrypted), jobs and screenshots in Postgres, and is protected by a team password.
- **Runner (on a team PC):** a small program that takes queued sites from the website and drives that PC's Google Chrome. It has to run on a PC because a person must be able to see Chrome to solve CAPTCHAs. Vercel cannot show a browser to anyone.

Several team members can run a runner at the same time; each site goes to exactly one runner.

## Deploy

1. **Push this folder to a GitHub repository.**
2. **Import the repository in Vercel** (Add New > Project). Framework: Next.js, no settings to change.
3. **Add a Postgres database:** in the Vercel project open Storage > Create Database and pick Neon (free tier is enough). This sets `DATABASE_URL`. Supabase or any other Postgres also works; paste its connection string as `DATABASE_URL`. Tables are created automatically on first use.
4. **Add environment variables** (Settings > Environment Variables), then redeploy:

   | Name | Value |
   |---|---|
   | `TEAM_PASSWORD` | the password the team types to open the dashboard |
   | `SESSION_SECRET` | long random string |
   | `RUNNER_TOKEN` | long random string |
   | `VAULT_KEY` | long random string. **Never change it** once accounts exist, or saved site passwords can't be read |

   Generate a random string with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Use

1. Open the Vercel address and log in with the team password.
2. **Runner setup tab:** on each Windows PC that will do submissions, copy the install command shown there, paste it into PowerShell and press Enter. It installs the runner into `%LOCALAPPDATA%\BacklinkRunner` (downloading Node.js if missing), connects it to the dashboard, adds a **Backlink Runner** desktop shortcut and starts it. Google Chrome must be installed. Windows blocks a downloaded `Start Runner.bat` (Smart App Control and SmartScreen block scripts carrying the "downloaded from the internet" mark), which is why Windows uses the command (`public/install.ps1`). On a Mac, download the runner zip from the same tab, unzip it, double-click **Start Runner (Mac).command** and paste the dashboard address and runner token when asked.
3. **Clients tab:** create a profile. Use an email address your team can read, since sites send verification emails there.
4. **Sites tab:** paste the target sites.
5. **Run tab:** pick a client, sites and a mode, and press Start. Chrome opens on the runner PC.

When a site needs a person (CAPTCHA, email verification, a form it doesn't understand, or review mode), the Run tab shows a **Needs you** card. Do the step in the Chrome window on that PC, then press **Continue**, or **Skip**.

### Modes

- **Review each submit** (recommended): fills the form, then waits for a person to check it.
- **Fully automatic**: presses Submit by itself; pauses only for CAPTCHAs, email verification or unknown forms.
- **Find listing pages only**: searches each site and saves its listing page, without signing up or submitting anything. Use it first on a new list of sites, check the results in the Sites tab, then run the submissions.

### How the runner finds a site's listing page

It works like a small search agent in the runner's Chrome (no AI service or API key needed):

1. The page saved for the site (found earlier, or set by hand with the pencil button in the Sites tab).
2. A short built-in list of known directories (`KNOWN_LISTING_PAGES` in `runner/runner.js`).
3. The links on the site as Chrome shows it, menus and footers included, ranked by their text and address ("Free listing", "List your business", "Sell on…", `/add-listing`).
4. Buttons that open a listing pop-up.
5. Exploring: it reads the most promising pages without opening them and follows their links, so pages two or three clicks deep ("For business" > "Plans" > "Get started") are found.
6. The sitemap: `robots.txt`, sitemap indexes, `.xml.gz` sitemaps and HTML "site map" pages, scored by the words in each address.
7. A web search for the site's own listing page (DuckDuckGo, then Bing), read from the public result pages.
8. The usual submit addresses (`/submit`, `/add-listing`, `/list-your-business`…).

Every candidate is scored from its link text, address, page title, headings and form (a form with business-name and website fields scores highest; a login wall or mobile-number sign-up counts as the way in). The best candidates are then opened in Chrome to confirm. The job details show the pages it considered, their scores and why it chose one.

### Results

Click any job (or **What it did** on a *Needs you* card) to see everything the runner did on that site: each step with its time, whether it signed up or logged in (and as whom), the listing page and how it was found, every field it filled and with what, the evidence for the result, and the latest screenshot.

- **submitted**: after Submit, the site showed a *new* confirmation message (quoted in the note) or moved to a thank-you page. Text that was already on the page never counts. Check that the listing goes live; many directories review submissions first.
- **unconfirmed**: Submit was pressed but no confirmation appeared, or the site showed an error (quoted in the note), or no field matched the client's details. Check the screenshot.
- **skipped**: the note says why: a team member pressed Skip, the run was stopped, or nobody responded for 30 minutes.
- **failed**: the site couldn't be opened (the note says why in plain words), or the runner stopped responding for 2 minutes (window closed, PC asleep, connection lost).

Pressing **Start run** again never queues a site twice: sites already queued or running for that client are left out. When the runner cannot find a site's listing page, open it in Chrome (in any tab) and press **Continue**; that page is saved for the site. You can also set or clear a site's listing page by hand with the pencil button in the **Sites** tab.

## Limits

- Form filling is heuristic. Some sites need manual help; the tool pauses instead of guessing.
- Client documents and screenshots are limited to 4 MB each (a Vercel request limit).
- The runner checks for new work every 5 seconds while its window is open. Close it when not in use to keep Vercel and database usage low.
- Submit only to sites that are relevant and valuable for the client. Mass submissions to low-quality directories can hurt rankings.

## Local development

```
npm install
cp .env.example .env.local   # fill in TEAM_PASSWORD, SESSION_SECRET, RUNNER_TOKEN, VAULT_KEY
npm run dev
```

Without `DATABASE_URL`, a built-in development database is stored in `.localdb/`. Point a runner at `http://localhost:3000` to test.

To bring clients, documents, sites and saved site accounts over from the old local-only tool (archived in `_old/backlink-tool`, ignored by git), stop the dev server and run `node --env-file=.env.local scripts/import-old-data.mjs`. To import into the live database instead, put its `DATABASE_URL` and the production `VAULT_KEY` in the env file you pass.

The runner download (`public/backlink-runner.zip`, holding `runner.js`, `package.json` and the two Start files inside a `backlink-runner/` folder) is built from `runner/` before every `npm run build`, so it always matches the current runner. Run `node scripts/build-runner-zip.mjs` to rebuild it for `npm run dev`.
