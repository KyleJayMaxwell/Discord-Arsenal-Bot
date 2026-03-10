# Arsenal Match Reminder Bot 🔴

A lightweight Discord bot that posts Arsenal FC match reminders to a channel via webhook. Runs entirely on **GitHub Actions** — no server, no cost, no maintenance.

## How It Works

The bot runs twice a day via a scheduled GitHub Action. Each run fetches Arsenal's upcoming fixtures from the [football-data.org](https://www.football-data.org/) API and sends a reminder to Discord if the timing conditions are met.

**Reminder logic:**
| Kickoff time | Reminder sent |
|---|---|
| At/after 7:30 AM PST | 7:30 AM PST on match day |
| Before 7:30 AM PST | 5:00 PM PST the day before |

The "before 7:30am" rule covers early European away games (e.g. a 12:45pm CET kickoff = 3:45am PST).

## Project Structure

```
arsenal-bot/
├── index.js                          # Entry point — run logic and CLI argument handling
├── fixtures.js                       # Fetches Arsenal's upcoming matches from the API
├── discord.js                        # Formats and sends the Discord webhook message
├── package.json                      # Dependencies (axios, dotenv)
├── .env.example                      # Template for local environment variables
└── .github/
    └── workflows/
        └── arsenal-reminder.yml      # GitHub Actions schedule and run config
```

## Setup

### 1. Get a Football API Key
Sign up for free at [football-data.org](https://www.football-data.org/). No credit card required. Copy your API key from the dashboard.

### 2. Create a Discord Webhook
- Open Discord and go to your server
- Right-click the channel you want reminders in → **Edit Channel**
- Go to **Integrations** → **Webhooks** → **New Webhook**
- Click **Copy Webhook URL** — keep this safe, treat it like a password

### 3. Add GitHub Secrets
In your GitHub repo go to **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab → **New repository secret**. Add both:

| Secret name | Value |
|---|---|
| `FOOTBALL_API_KEY` | Your key from football-data.org |
| `DISCORD_WEBHOOK_URL` | Your Discord webhook URL |

### 4. Push to GitHub
```bash
git add .
git commit -m "initial commit"
git push
```

GitHub Actions will automatically run at 7:30 AM and 5:00 PM PST every day. No further setup needed.

## Testing

### Test via GitHub Actions UI (recommended)
Go to your repo → **Actions** tab → **Arsenal Match Reminder** → **Run workflow** → select `test-webhook` → **Run workflow**

This fetches the next Arsenal match and sends the reminder immediately, bypassing all date/time logic. Check your Discord channel — the message should appear within ~30 seconds.

### Test locally
```bash
# 1. Copy the env template and fill in your keys
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Run in different modes:
npm run test-webhook   # Send reminder immediately (bypass all logic)
npm run test-morning   # Simulate the 7:30am check
npm run test-evening   # Simulate the 5:00pm check
```

## Making Changes

**Change the reminder times:**
1. Update the cron schedule in `.github/workflows/arsenal-reminder.yml`
2. Update the UTC time detection logic in the "Determine run mode" step of the same file

**Change the kickoff cutoff time (currently 7:30am PST):**
1. Update the `isEarlyKickoff()` function in `index.js`

**Change the Discord message layout:**
1. Edit the `embeds` array in `discord.js`

**Follow a different team:**
1. Find your team's ID at `https://api.football-data.org/v4/teams` (requires your API key)
2. Update `ARSENAL_TEAM_ID` in both `fixtures.js` and `discord.js`

## Keeping It Running

GitHub will pause the scheduled workflow if the repo has no activity for **60 days**. You'll get an email warning before this happens. To re-enable it, go to the **Actions** tab and click **Enable workflow**.

## Dependencies

| Package | Purpose |
|---|---|
| `axios` | HTTP requests to the football API and Discord webhook |
| `dotenv` | Loads `.env` file for local development |