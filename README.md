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
2. **Runner setup tab:** download the runner on each PC that will do submissions, unzip it, and double-click **Start Runner.bat** (Windows) or **Start Runner (Mac).command**. On first start, paste the dashboard address and runner token shown in that tab. Google Chrome must be installed; Node.js is downloaded automatically if missing.
3. **Clients tab:** create a profile. Use an email address your team can read, since sites send verification emails there.
4. **Sites tab:** paste the target sites.
5. **Run tab:** pick a client, sites and a mode, and press Start. Chrome opens on the runner PC.

When a site needs a person (CAPTCHA, email verification, a form it doesn't understand, or review mode), the Run tab shows a **Needs you** card. Do the step in the Chrome window on that PC, then press **Continue**, or **Skip**.

### Modes

- **Review before each submit** (recommended): fills the form, then waits for a person to check it.
- **Fully automatic submit**: presses Submit by itself; pauses only for CAPTCHAs, email verification or unknown forms.

### Results

- **submitted**: the site showed a confirmation message. Check that the listing goes live; many directories review submissions first.
- **unconfirmed**: Submit was pressed but no confirmation appeared. Check the screenshot.
- **failed**: the site couldn't be opened, or the runner stopped responding for 2 minutes (window closed, PC asleep, connection lost).

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
