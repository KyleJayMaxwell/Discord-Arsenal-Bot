# Arsenal Match Reminder Bot 🔴

Posts Arsenal FC match reminders to a Discord channel via webhook, powered by GitHub Actions — no server required.

## Reminder Logic

- Match kicks off **at/after 7am PST** → reminder sent at **7:30 AM PST** that day
- Match kicks off **before 7am PST** → reminder sent at **5:00 PM PST** the day before

## Setup

### 1. Get a Football API Key
Sign up free at [football-data.org](https://www.football-data.org/) and copy your API key.

### 2. Create a Discord Webhook
- Go to your Discord server → right-click the channel → **Edit Channel**
- **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook URL**

### 3. Add GitHub Secrets
In your GitHub repo go to **Settings** → **Secrets and variables** → **Actions** → **New repository secret** and add:
- `FOOTBALL_API_KEY`
- `DISCORD_WEBHOOK_URL`

### 4. Push to GitHub
```bash
git add .
git commit -m "initial commit"
git push
```

GitHub Actions will automatically run at 7:30 AM and 5:00 PM PST every day.

## Manual Test Run
Go to your repo → **Actions** tab → **Arsenal Match Reminder** → **Run workflow** → select `test-webhook` to fire an immediate reminder.

## Local Testing
```bash
cp .env.example .env  # fill in your keys
npm install
npm run test-webhook  # send immediately, bypass logic
npm run test-morning  # simulate 7:30am check
npm run test-evening  # simulate 5pm check
```
