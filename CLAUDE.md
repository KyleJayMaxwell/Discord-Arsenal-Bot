# Arsenal Match Reminder Bot

A Node.js bot that fetches Arsenal FC fixtures and posts match reminders to a Discord channel via webhook. Hosted on GitHub Actions — no persistent server.

## Architecture

Single process, runs every 30 minutes via GitHub Actions cron. All scheduling logic lives in `index.js`. State is persisted between runs using GitHub Actions Variables (not secrets).

### Two-phase daily flow

**3am window** — calls the football-data.org API once, calculates the send time, stores everything in GitHub Variables. No further API calls for the rest of the day.

**Every 30 min** — reads GitHub Variables, checks if it's within the send window, fires the Discord message if so, then marks `SCHEDULE_SENT=true` to prevent double-sends.

### Files

- `index.js` — entry point, all scheduling and orchestration logic
- `fixtures.js` — football-data.org API calls (`getUpcomingMatch`, `getNextMatch`)
- `discord.js` — Discord webhook formatting and sending (`sendMatchReminder`, `sendNoMatchMessage`)
- `RAILWAY.md` — alternative deployment guide for Railway (persistent process with node-cron)

## Send time rules

- Game today, kickoff at/after 7:30am → send at 7:00am
- Game today, kickoff before 7:30am → send 30 mins before kickoff
- No game today → send at 6:30am
- All times in `America/Los_Angeles` (DST handled automatically)
- 29-minute window buffer absorbs GitHub Actions scheduling delays

## GitHub Actions Variables (state, not secrets)

These are created automatically on first run:

| Variable | Description |
|---|---|
| `SCHEDULE_DATE` | Date the schedule was built (`YYYY-MM-DD`) |
| `SCHEDULE_SEND_TIME` | Time to send the message (`H:MM` in LA time) |
| `SCHEDULE_HAS_MATCH` | `"true"` or `"false"` |
| `SCHEDULE_MATCH_DATA` | Slimmed match object as JSON (only fields discord.js needs) |
| `SCHEDULE_SENT` | `"true"` once the message has been sent today |

## Secrets required

Set in repo Settings → Secrets and variables → Actions → **Secrets**:

| Secret | Source |
|---|---|
| `FOOTBALL_API_KEY` | football-data.org free tier |
| `DISCORD_WEBHOOK_URL` | Discord channel → Integrations → Webhooks |

## Permissions

The workflow requires **Read and write permissions** for `GITHUB_TOKEN`. Set in repo Settings → Actions → General → Workflow permissions.

## Local development

```bash
cp .env.example .env   # fill in FOOTBALL_API_KEY and DISCORD_WEBHOOK_URL
npm install
npm run test-webhook   # sends immediately, bypasses all scheduling logic
node index.js          # normal scheduled run
```

## Configuration

All timing constants are at the top of `index.js`. No workflow changes needed to adjust send times:

```js
const EARLIEST_SEND_HOUR   = 7;   // Match reminders never fire before 7:00am
const LATE_KICKOFF_HOUR    = 7;   // Kickoffs at/after 7:30am → remind at 7:00am
const LATE_KICKOFF_MINUTE  = 30;
const REMINDER_OFFSET_MINS = 30;  // Mins before kickoff for early games
const NO_MATCH_SEND_HOUR   = 6;   // No-match message time
const NO_MATCH_SEND_MINUTE = 30;
const CHECK_HOUR           = 3;   // When to call the API (3am)
const WINDOW_MINS          = 29;  // Tolerance for GitHub Actions delays
```

## Key decisions

- **Webhook over full Discord bot** — one-way posting only, no slash commands needed
- **GitHub Actions over Railway** — free, but timing is best-effort (~0-15 min delay). See `RAILWAY.md` for a precise alternative
- **GitHub Variables for state** — persists `sent` flag across separate job runs; resets each day via `SCHEDULE_DATE` check
- **PATCH-first on variable writes** — avoids a redundant GET before every write
- **Slimmed match payload** — only stores the 5 fields `discord.js` needs, keeps well under GitHub's 48KB variable limit
- **Arsenal team ID is `57`** on football-data.org — hardcoded in both `fixtures.js` and `discord.js`