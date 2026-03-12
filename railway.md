# Running on Railway Instead of GitHub Actions

This is an alternative deployment guide for running the Arsenal bot on [Railway](https://railway.app) as a persistent Node.js process with its own cron scheduler, instead of GitHub Actions.

## How It Differs from GitHub Actions

| | GitHub Actions | Railway |
|---|---|---|
| Cost | Free | ~$1–3/month (hobby plan) |
| Process | Runs every 30 mins, exits | Always-on Node.js process |
| State | GitHub Variables API | In-memory (resets on redeploy) |
| Scheduling | External cron | `node-cron` inside the app |
| Setup complexity | Medium | Simple |

On Railway the bot runs as a long-lived process, so you don't need the GitHub Variables API for state — you can just use an in-memory variable. `node-cron` handles the scheduling internally.

---

## Railway-specific index file

Create a new file called `index.railway.js` in your project root. This replaces `index.js` when deploying to Railway.

```js
/**
 * index.railway.js
 *
 * Railway deployment entry point for the Arsenal Match Reminder bot.
 *
 * Runs as a persistent process. Uses node-cron for scheduling:
 *   - 3:00 AM LA time  → fetch fixtures, calculate send time, store in memory
 *   - Every 30 mins    → check if it's time to send, fire once per day
 *
 * No GitHub Variables API needed — state lives in memory for the day.
 * On redeploy the schedule resets, which is fine since it re-checks at 3am.
 *
 * SEND TIME RULES (same as GitHub Actions version)
 *   Game today, kickoff at/after 7:30am → send at 7:00am
 *   Game today, kickoff before 7:30am   → send 30 mins before kickoff
 *   No game today                       → send at 6:30am
 */

require('dotenv').config();
const cron = require('node-cron');
const { getUpcomingMatch, getNextMatch } = require('./fixtures');
const { sendMatchReminder, sendNoMatchMessage } = require('./discord');

// ─────────────────────────────────────────────────────
// Configuration (all times in America/Los_Angeles)
// ─────────────────────────────────────────────────────
const EARLIEST_SEND_HOUR   = 7;
const EARLIEST_SEND_MINUTE = 0;
const LATE_KICKOFF_HOUR    = 7;
const LATE_KICKOFF_MINUTE  = 30;
const REMINDER_OFFSET_MINS = 30;
const NO_MATCH_SEND_HOUR   = 6;
const NO_MATCH_SEND_MINUTE = 30;
const WINDOW_MINS          = 29;

// ─────────────────────────────────────────────────────
// In-memory schedule state (resets on process restart)
// ─────────────────────────────────────────────────────
let schedule = {
  date: null,        // YYYY-MM-DD the schedule was built for
  sendHour: null,    // Hour to send (LA time)
  sendMinute: null,  // Minute to send (LA time)
  hasMatch: false,   // Whether Arsenal play today
  sent: false,       // Whether the message has been sent today
};

// ─────────────────────────────────────────────────────
// Environment variable validation
// ─────────────────────────────────────────────────────
const required = ['FOOTBALL_API_KEY', 'DISCORD_WEBHOOK_URL'];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('your_')) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────────────
function getCurrentLATime() {
  const now = new Date();
  const hour = parseInt(
    now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' })
  );
  const minute = parseInt(
    now.toLocaleString('en-US', { minute: '2-digit', timeZone: 'America/Los_Angeles' })
  );
  return { hour, minute };
}

function getTodayLA() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function toMins({ hour, minute }) {
  return hour * 60 + minute;
}

function fromMins(totalMins) {
  return { hour: Math.floor(totalMins / 60), minute: totalMins % 60 };
}

function fmtTime({ hour, minute }) {
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function calcSendTime(kickoffUTC) {
  const kickoff = new Date(kickoffUTC);
  const kickoffHour = parseInt(
    kickoff.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' })
  );
  const kickoffMinute = parseInt(
    kickoff.toLocaleString('en-US', { minute: '2-digit', timeZone: 'America/Los_Angeles' })
  );
  const kickoffMins   = kickoffHour * 60 + kickoffMinute;
  const lateThreshold = LATE_KICKOFF_HOUR * 60 + LATE_KICKOFF_MINUTE;
  const earliestMins  = EARLIEST_SEND_HOUR * 60 + EARLIEST_SEND_MINUTE;

  return kickoffMins >= lateThreshold
    ? fromMins(earliestMins)
    : fromMins(kickoffMins - REMINDER_OFFSET_MINS);
}

function isWithinWindow(sendHour, sendMinute) {
  const currentMins = toMins(getCurrentLATime());
  const sendMins    = toMins({ hour: sendHour, minute: sendMinute });
  return currentMins >= sendMins && currentMins < sendMins + WINDOW_MINS;
}

// ─────────────────────────────────────────────────────
// Job 1: 3am fixture check
// Fetches today's fixtures and stores the send time in memory
// ─────────────────────────────────────────────────────
async function runCheck() {
  const today = getTodayLA();
  console.log(`🔍 3am check — fetching fixtures for ${today}...`);

  try {
    const match = await getUpcomingMatch();

    if (match) {
      const sendTime = calcSendTime(match.utcDate);
      schedule = { date: today, sendHour: sendTime.hour, sendMinute: sendTime.minute, hasMatch: true, sent: false };
      console.log(`📅 Arsenal play today: ${match.homeTeam.name} vs ${match.awayTeam.name}`);
      console.log(`⏰ Reminder scheduled for ${fmtTime(sendTime)} LA time`);
    } else {
      schedule = { date: today, sendHour: NO_MATCH_SEND_HOUR, sendMinute: NO_MATCH_SEND_MINUTE, hasMatch: false, sent: false };
      console.log(`💤 No match today. No-match message scheduled for ${NO_MATCH_SEND_HOUR}:${String(NO_MATCH_SEND_MINUTE).padStart(2,'0')}`);
    }
  } catch (err) {
    console.error('❌ Error during fixture check:', err.message);
  }
}

// ─────────────────────────────────────────────────────
// Job 2: Every 30 mins — send if it's time
// ─────────────────────────────────────────────────────
async function runSend() {
  const { hour, minute } = getCurrentLATime();
  const today = getTodayLA();

  console.log(`🕐 Send check — LA time: ${fmtTime({ hour, minute })}`);

  // Schedule not yet set for today (e.g. bot just restarted after 3am)
  // Run a check immediately to catch up
  if (!schedule.date || schedule.date !== today) {
    console.log('⚠️  No schedule for today yet — running fixture check now...');
    await runCheck();
  }

  if (schedule.sent) {
    console.log('✅ Already sent today. Skipping.');
    return;
  }

  if (!isWithinWindow(schedule.sendHour, schedule.sendMinute)) {
    console.log(`⏩ Outside send window (send at ${fmtTime({ hour: schedule.sendHour, minute: schedule.sendMinute })}). Skipping.`);
    return;
  }

  console.log('⏰ Within send window — sending message!');

  try {
    if (schedule.hasMatch) {
      const match = await getUpcomingMatch();
      if (match) {
        await sendMatchReminder(match, new Date(match.utcDate));
      } else {
        const nextMatch = await getNextMatch();
        await sendNoMatchMessage(nextMatch);
      }
    } else {
      const nextMatch = await getNextMatch();
      await sendNoMatchMessage(nextMatch);
    }

    schedule.sent = true;
    console.log('✅ Message sent and marked as sent for today.');
  } catch (err) {
    console.error('❌ Error sending message:', err.message);
  }
}

// ─────────────────────────────────────────────────────
// Cron schedule
// node-cron uses local system time — Railway runs in UTC by default.
// Set the TZ environment variable in Railway to 'America/Los_Angeles'
// so these cron expressions match LA time directly.
// ─────────────────────────────────────────────────────

// 3:00 AM — fetch fixtures and set schedule
cron.schedule('0 3 * * *', runCheck, { timezone: 'America/Los_Angeles' });

// Every 30 mins — check if it's time to send
cron.schedule('0,30 * * * *', runSend, { timezone: 'America/Los_Angeles' });

console.log('🤖 Arsenal Match Bot started (Railway mode)');
console.log('   → Fixture check: 3:00 AM LA time daily');
console.log('   → Send check: every 30 mins');

// Run an initial check on startup in case the bot restarted mid-day
runCheck();
```

---

## Additional dependency

Railway uses `node-cron` which isn't in the current `package.json`. Add it:

```bash
npm install node-cron
```

Then add it to `package.json` dependencies:

```json
"node-cron": "^3.0.0"
```

---

## Railway setup steps

**1. Push your code to GitHub** (if not already done)

**2. Sign up at [railway.app](https://railway.app)**
Log in with your GitHub account.

**3. Create a new project**
- Click **New Project** → **Deploy from GitHub repo**
- Select your `arsenal-bot` repo

**4. Set environment variables**
In your Railway project go to **Variables** and add:

| Variable | Value |
|---|---|
| `FOOTBALL_API_KEY` | Your football-data.org key |
| `DISCORD_WEBHOOK_URL` | Your Discord webhook URL |

**5. Set the start command**
In Railway go to **Settings → Deploy** and set the start command to:
```
node index.railway.js
```

**6. Deploy**
Railway will build and run the bot. It stays alive 24/7.

---

## Key difference from GitHub Actions version

The GitHub Actions version uses the GitHub Variables API to store `SCHEDULE_SENT` so it survives across separate job runs. On Railway the process never stops, so an in-memory variable does the same job more simply. If Railway restarts the process mid-day (e.g. after a redeploy), `runCheck()` runs on startup to rebuild the schedule immediately.