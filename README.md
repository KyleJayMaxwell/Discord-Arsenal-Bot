# Arsenal Match Reminder Bot 🔴

> A lightweight Node.js bot that posts Arsenal FC match reminders to Discord every morning — no server, no cost, runs entirely on GitHub Actions.

## Overview

Every morning the bot either posts a match reminder with kickoff details, or a no-match message with a countdown to the next fixture. It runs every 30 minutes via GitHub Actions cron. Once a day at 3am (LA time) it calls the football API, calculates the send time, and stores that plan in GitHub Actions Variables. Every subsequent run reads the plan, fires the Discord message once when the window opens, then goes quiet for the rest of the day.

**Reminder timing:**

| Situation | Message sent |
|---|---|
| Game today, kickoff at/after 7:30am | 7:00am |
| Game today, kickoff before 7:30am | 30 mins before kickoff |
| No game today | 6:30am with countdown to next fixture |

All times are `America/Los_Angeles`. DST is handled automatically.

---

## What You'll Need

- A [GitHub](https://github.com) account (free)
- A [football-data.org](https://www.football-data.org/) API key (free tier, no credit card)
- A Discord server where you have admin access

---

## Installation

### 1. Fork or clone this repo

```bash
git clone https://github.com/yourusername/arsenal-bot.git
cd arsenal-bot
```

Or click **Fork** on GitHub to copy it to your account.

### 2. Get a football API key

Sign up at [football-data.org](https://www.football-data.org/) — your API key is on the account dashboard after signup.

### 3. Create a Discord webhook

1. Open your server and right-click the channel you want reminders in → **Edit Channel**
2. Go to **Integrations** → **Webhooks** → **New Webhook**
3. Name it (e.g. "Arsenal Bot") and click **Copy Webhook URL**

Treat the webhook URL like a password. If it's ever exposed publicly, delete it and create a new one.

### 4. Add GitHub Secrets

In your repo, go to **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab, then add:

| Secret name | Value |
|---|---|
| `FOOTBALL_API_KEY` | Your key from football-data.org |
| `DISCORD_WEBHOOK_URL` | Your webhook URL from Step 3 |

### 5. Enable workflow read/write permissions

The bot reads and writes GitHub Actions Variables to store the daily schedule. By default this is restricted.

1. Go to **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions**
3. Select **Read and write permissions** → **Save**

### 6. Push your code (if running locally)

```bash
git add .
git commit -m "initial commit"
git push
```

If you forked on GitHub, the workflow is already in place.

### 7. Enable the workflow (if needed)

GitHub sometimes disables workflows on forked repos.

1. Go to the **Actions** tab
2. If you see a banner saying workflows are disabled, click **Enable workflows**

---

## Usage

### Run a test from GitHub

1. Go to **Actions** → **Arsenal Match Reminder** in the sidebar
2. Click **Run workflow** → leave mode as `test-webhook` → **Run workflow**
3. Check your Discord channel in ~30 seconds

You should see either a match reminder card or a no-match countdown card. If nothing appears, click into the run and expand **Run Arsenal reminder** to read the logs.

### Run locally

```bash
# Copy the env template and fill in your keys
cp .env.example .env

# Install dependencies
npm install

# Send a test message (bypasses scheduling logic)
npm run test-webhook

# Run a normal scheduled check (respects time windows)
node index.js
```

---

## Project Structure

```
arsenal-bot/
├── index.js                          # Entry point — scheduling and orchestration
├── fixtures.js                       # Fetches Arsenal fixtures from football-data.org
├── discord.js                        # Formats and sends Discord webhook messages
├── package.json                      # Dependencies: axios, dotenv
├── .env.example                      # Template for local environment variables
├── CLAUDE.md                         # Project context for Claude Code
├── RAILWAY.md                        # Alternative deployment guide for Railway
└── .github/
    └── workflows/
        └── arsenal-reminder.yml      # GitHub Actions cron schedule and job config
```

---

## Customisation

### Change the reminder times

All timing constants are at the top of `index.js`:

```js
const EARLIEST_SEND_HOUR   = 7;    // Match reminders never fire before this hour
const EARLIEST_SEND_MINUTE = 0;
const LATE_KICKOFF_HOUR    = 7;    // Kickoffs at/after this time → use earliest send time
const LATE_KICKOFF_MINUTE  = 30;
const REMINDER_OFFSET_MINS = 30;   // Mins before kickoff for early games
const NO_MATCH_SEND_HOUR   = 6;    // When to send the no-match message
const NO_MATCH_SEND_MINUTE = 30;
const CHECK_HOUR           = 3;    // When the bot calls the API each day
```

No workflow changes needed — update these values and push.

### Follow a different team

1. Find your team's ID at `https://api.football-data.org/v4/teams` (pass your API key as a header: `X-Auth-Token: YOUR_KEY`)
2. Update `ARSENAL_TEAM_ID` in both `fixtures.js` and `discord.js`

### Change the Discord message layout

Edit the `embeds` array in `discord.js`. Discord's embed docs are at [discord.com/developers/docs/resources/message#embed-object](https://discord.com/developers/docs/resources/message#embed-object).

---

## GitHub Actions Variables

The bot creates and manages these automatically — you don't need to touch them. They reset each day.

| Variable | Description |
|---|---|
| `SCHEDULE_DATE` | Date the schedule was built (`YYYY-MM-DD`) |
| `SCHEDULE_SEND_TIME` | Time to send the message (`H:MM` LA time) |
| `SCHEDULE_HAS_MATCH` | `"true"` or `"false"` |
| `SCHEDULE_MATCH_DATA` | Match details as JSON (used at send time) |
| `SCHEDULE_SENT` | `"true"` once today's message has been sent |

View them in **Settings** → **Secrets and variables** → **Actions** → **Variables** tab.

---

## Keeping It Running

GitHub pauses scheduled workflows after **60 days of repo inactivity**. You'll get an email warning before this happens. To re-enable, go to the **Actions** tab and click **Enable workflow**.

---

## Deploying on Railway (alternative)

For more precise timing — GitHub Actions can run a few minutes late — you can deploy on Railway as a persistent process instead. See [RAILWAY.md](./RAILWAY.md) for instructions. Railway costs roughly $1–2/month for this workload.

---

## Dependencies

| Package | Purpose |
|---|---|
| `axios` | HTTP requests to the football API, Discord webhook, and GitHub API |
| `dotenv` | Loads `.env` for local development |