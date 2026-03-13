/**
 * index.js
 *
 * Arsenal Match Reminder — entry point.
 *
 * Runs every 30 minutes via GitHub Actions. Uses environment variables
 * stored as GitHub Actions Variables (not secrets) to persist state across
 * runs within the same day:
 *
 *   SCHEDULE_DATE       — "YYYY-MM-DD" the date the schedule was built for
 *   SCHEDULE_SEND_TIME  — "H:MM" earliest time to send the message (LA time)
 *   SCHEDULE_HAS_MATCH  — "true" or "false"
 *   SCHEDULE_MATCH_DATA — slimmed match object as JSON
 *   SCHEDULE_SENT       — "true" once the message has been sent today
 *
 * These are written back via the GitHub API after each relevant run.
 *
 * ─────────────────────────────────────────────────────
 * FLOW
 * ─────────────────────────────────────────────────────
 *
 *   Every 30 min run:
 *   ├── Is schedule stale (not from today)?
 *   │   └── YES → Call football API, calculate send time, save to GitHub vars
 *   │           → Then fall through and check send window immediately
 *   ├── Is SCHEDULE_SENT already "true" for today?
 *   │   └── YES → Exit (message already sent today)
 *   └── Is current time within the send window?
 *       ├── YES → Send message, set SCHEDULE_SENT=true
 *       └── NO  → Exit silently
 *
 * ─────────────────────────────────────────────────────
 * SEND TIME RULES
 * ─────────────────────────────────────────────────────
 *   Match today, kickoff at/after 7:30am → send between 6:30am and 7:30am
 *   Match today, kickoff before 7:30am   → send from 60 mins before kickoff,
 *                                          window never closes (sends even mid-game)
 *   No match today                       → send at 6:30am (29-min window)
 *
 * ─────────────────────────────────────────────────────
 * SCHEDULE BUILD
 * ─────────────────────────────────────────────────────
 *   Built on the first run of each day, regardless of time.
 *   This handles GitHub Actions silently dropping scheduled runs.
 *
 * ─────────────────────────────────────────────────────
 * CLI USAGE
 * ─────────────────────────────────────────────────────
 *   node index.js              → Normal scheduled run
 *   node index.js test-webhook → Bypass all logic, send immediately
 *
 * ─────────────────────────────────────────────────────
 * REQUIRED ENV VARS
 * ─────────────────────────────────────────────────────
 *   FOOTBALL_API_KEY      → football-data.org API key (GitHub Secret)
 *   DISCORD_WEBHOOK_URL   → Discord channel webhook URL (GitHub Secret)
 *   GH_TOKEN              → Fine-grained PAT with Variables: read/write on this repo
 *                           (store as VARIABLES_TOKEN secret, passed as GH_TOKEN)
 *   GITHUB_REPOSITORY     → auto-provided by GitHub Actions (owner/repo)
 *
 * ─────────────────────────────────────────────────────
 * CONFIGURATION — change times here, no workflow changes needed
 * ─────────────────────────────────────────────────────
 */

require('dotenv').config();
const axios = require('axios');
const { getUpcomingMatch, getNextMatch } = require('./fixtures');
const { sendMatchReminder, sendNoMatchMessage } = require('./discord');

// ─────────────────────────────────────────────────────
// Timing configuration (all LA / America/Los_Angeles time)
// ─────────────────────────────────────────────────────
const LATE_KICKOFF_HOUR         = 7;    // Kickoffs at/after 7:30am → use fixed morning window
const LATE_KICKOFF_MINUTE       = 30;
const LATE_SEND_WINDOW_START    = { hour: 6, minute: 30 }; // Start of morning send window
const LATE_SEND_WINDOW_END      = { hour: 7, minute: 30 }; // End of morning send window
const EARLY_KICKOFF_OFFSET_MINS = 60;  // Open send window this many mins before early kickoffs
const NO_MATCH_SEND_HOUR        = 6;   // No-match message sends from this time onwards, no upper bound
const NO_MATCH_SEND_MINUTE      = 30;

// ─────────────────────────────────────────────────────
// Environment variable validation
// Catches missing/unconfigured vars before any API calls are made
// ─────────────────────────────────────────────────────
const required = ['FOOTBALL_API_KEY', 'DISCORD_WEBHOOK_URL', 'GH_TOKEN', 'GITHUB_REPOSITORY'];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('your_')) {
    console.error(`❌ Missing or unconfigured environment variable: ${key}`);
    if (key === 'GH_TOKEN') {
      console.error('   → Create a fine-grained PAT with Variables: read/write on this repo');
      console.error('   → Store it as VARIABLES_TOKEN in repo Settings → Secrets → Actions');
      console.error('   → Ensure the workflow passes it as GH_TOKEN in the env block');
    } else if (key === 'GITHUB_REPOSITORY') {
      console.error('   → This is auto-provided by GitHub Actions');
      console.error('   → Ensure the workflow passes it as GITHUB_REPOSITORY: ${{ github.repository }}');
    } else {
      console.error('   → Locally: copy .env.example to .env and fill in your values');
      console.error('   → Production: add the secret in GitHub repo Settings → Secrets');
    }
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────────────

/** Returns current { hour, minute } in LA time. DST handled automatically. */
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

/** Returns today's date as YYYY-MM-DD in LA time. */
function getTodayLA() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** Converts { hour, minute } to total minutes since midnight. */
function toMins({ hour, minute }) {
  return hour * 60 + minute;
}

/** Formats { hour, minute } as "H:MM" for logging. */
function fmtTime({ hour, minute }) {
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

/**
 * Calculates the earliest time the send window opens for a given kickoff.
 *
 *   Kickoff at/after 7:30am → window opens at 6:30am
 *   Kickoff before 7:30am   → window opens 60 mins before kickoff
 */
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

  if (kickoffMins >= lateThreshold) {
    return { hour: LATE_SEND_WINDOW_START.hour, minute: LATE_SEND_WINDOW_START.minute };
  } else {
    const openMins = kickoffMins - EARLY_KICKOFF_OFFSET_MINS;
    return { hour: Math.floor(openMins / 60), minute: openMins % 60 };
  }
}

/**
 * Returns true if it's time to send the message.
 *
 * Late kickoff (at/after 7:30am):
 *   Window = 6:30am–7:30am. Outside this range → don't send.
 *
 * Early kickoff (before 7:30am):
 *   Window opens 60 mins before kickoff and never closes.
 *   Sends even if the game is already underway.
 *
 * No match:
 *   Window = 6:30am to 6:30am + 29 mins.
 */
function isWithinWindow(sendTimeStr, hasMatch, kickoffUTC) {
  const currentMins = toMins(getCurrentLATime());
  const [sendHour, sendMinute] = sendTimeStr.split(':').map(Number);
  const sendMins = toMins({ hour: sendHour, minute: sendMinute });

  if (!hasMatch) {
    // No-match message: send any time from 6:30am onwards — no upper bound
    return currentMins >= sendMins;
  }

  const kickoff = new Date(kickoffUTC);
  const kickoffHour = parseInt(
    kickoff.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' })
  );
  const kickoffMinute = parseInt(
    kickoff.toLocaleString('en-US', { minute: '2-digit', timeZone: 'America/Los_Angeles' })
  );
  const kickoffMins   = kickoffHour * 60 + kickoffMinute;
  const lateThreshold = LATE_KICKOFF_HOUR * 60 + LATE_KICKOFF_MINUTE;

  if (kickoffMins >= lateThreshold) {
    // Late kickoff: hard window 6:30am–7:30am
    const windowEnd = toMins(LATE_SEND_WINDOW_END);
    return currentMins >= sendMins && currentMins < windowEnd;
  } else {
    // Early kickoff: open-ended — send from 60 mins before kickoff, never closes
    return currentMins >= sendMins;
  }
}

// ─────────────────────────────────────────────────────
// GitHub Variables API
// Reads and writes repository variables to persist schedule state
// across runs. Variables are stored under the repo's Actions variables.
//
// Required: GH_TOKEN env var — fine-grained PAT with Variables: read/write
//           GITHUB_REPOSITORY env var (auto-set by Actions: "owner/repo")
// ─────────────────────────────────────────────────────
const GH_API = 'https://api.github.com';

async function getVariable(name) {
  try {
    const res = await axios.get(
      `${GH_API}/repos/${process.env.GITHUB_REPOSITORY}/actions/variables/${name}`,
      { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' } }
    );
    return res.data.value;
  } catch (err) {
    if (err.response?.status === 404) return null;
    if (err.response?.status === 403) {
      throw new Error(
        `403 reading variable "${name}" — GH_TOKEN lacks permission. ` +
        `Ensure VARIABLES_TOKEN is a fine-grained PAT with Variables: read/write on this repo.`
      );
    }
    throw new Error(`Failed to read variable "${name}": ${err.message}`);
  }
}

async function setVariable(name, value) {
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const body    = { name, value: String(value) };

  try {
    await axios.patch(
      `${GH_API}/repos/${process.env.GITHUB_REPOSITORY}/actions/variables/${name}`,
      body, { headers }
    );
  } catch (err) {
    if (err.response?.status === 404) {
      try {
        await axios.post(
          `${GH_API}/repos/${process.env.GITHUB_REPOSITORY}/actions/variables`,
          body, { headers }
        );
      } catch (postErr) {
        if (postErr.response?.status === 403) {
          throw new Error(
            `403 creating variable "${name}" — GH_TOKEN lacks permission. ` +
            `Ensure VARIABLES_TOKEN is a fine-grained PAT with Variables: read/write on this repo.`
          );
        }
        throw new Error(`Failed to create variable "${name}": ${postErr.message}`);
      }
    } else if (err.response?.status === 403) {
      throw new Error(
        `403 updating variable "${name}" — GH_TOKEN lacks permission. ` +
        `Ensure VARIABLES_TOKEN is a fine-grained PAT with Variables: read/write on this repo.`
      );
    } else {
      throw new Error(`Failed to update variable "${name}": ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────
// Main run logic
// ─────────────────────────────────────────────────────
async function run() {
  const isTest = process.argv[2] === 'test-webhook';
  const { hour, minute } = getCurrentLATime();
  const today = getTodayLA();

  console.log(`🕐 Current LA time: ${fmtTime({ hour, minute })} | Date: ${today}`);

  // ── Test mode ─────────────────────────────────────────────────────────────
  if (isTest) {
    console.log('🧪 Test mode — sending immediately...');
    const match = await getUpcomingMatch();
    if (match) {
      await sendMatchReminder(match, new Date(match.utcDate));
    } else {
      const nextMatch = await getNextMatch();
      await sendNoMatchMessage(nextMatch);
    }
    console.log('✅ Test message sent! Check your Discord channel.');
    return;
  }

  // ── Read today's schedule from GitHub Variables ───────────────────────────
  let scheduleDate     = await getVariable('SCHEDULE_DATE');
  let scheduleSendTime = await getVariable('SCHEDULE_SEND_TIME');
  let scheduleSent     = await getVariable('SCHEDULE_SENT');
  let scheduleHasMatch = await getVariable('SCHEDULE_HAS_MATCH');

  const scheduleIsStale = scheduleDate !== today;

  console.log(`📋 Schedule: date=${scheduleDate}, sendTime=${scheduleSendTime}, sent=${scheduleSent}, hasMatch=${scheduleHasMatch}, stale=${scheduleIsStale}`);

  // ── Build schedule on first run of the day (any time) ────────────────────
  if (scheduleIsStale) {
    console.log('🔍 Schedule is stale — fetching today\'s fixtures and building schedule...');

    const match = await getUpcomingMatch();

    let sendTime;
    let hasMatch;

    if (match) {
      sendTime = calcSendTime(match.utcDate);
      hasMatch = true;
      console.log(`📅 Arsenal play today: ${match.homeTeam.name} vs ${match.awayTeam.name}`);
      console.log(`⏰ Send window opens at ${fmtTime(sendTime)} LA time`);
    } else {
      sendTime = { hour: NO_MATCH_SEND_HOUR, minute: NO_MATCH_SEND_MINUTE };
      hasMatch = false;
      console.log(`💤 No match today. No-match message will send at ${fmtTime(sendTime)} LA time`);
    }

    const nextMatch = hasMatch ? null : await getNextMatch();
    const rawMatch  = hasMatch ? match : nextMatch;

    const matchData = rawMatch ? {
      utcDate:     rawMatch.utcDate,
      venue:       rawMatch.venue,
      competition: { name: rawMatch.competition.name },
      homeTeam:    { id: rawMatch.homeTeam.id, name: rawMatch.homeTeam.name },
      awayTeam:    { id: rawMatch.awayTeam.id, name: rawMatch.awayTeam.name },
    } : null;
    const matchJSON = matchData ? JSON.stringify(matchData) : 'null';

    await setVariable('SCHEDULE_DATE',       today);
    await setVariable('SCHEDULE_SEND_TIME',  fmtTime(sendTime));
    await setVariable('SCHEDULE_HAS_MATCH',  String(hasMatch));
    await setVariable('SCHEDULE_MATCH_DATA', matchJSON);
    await setVariable('SCHEDULE_SENT',       'false');

    console.log('✅ Schedule saved to GitHub Variables.');

    // Update locals so the send check below uses fresh values without
    // needing another round of API reads
    scheduleSendTime = fmtTime(sendTime);
    scheduleSent     = 'false';
    scheduleHasMatch = String(hasMatch);
  }

  // ── Already sent today — nothing to do ───────────────────────────────────
  if (scheduleSent === 'true') {
    console.log('✅ Message already sent today. Exiting.');
    return;
  }

  // ── Read match data ───────────────────────────────────────────────────────
  const scheduleMatchData = await getVariable('SCHEDULE_MATCH_DATA');
  const storedMatch = scheduleMatchData && scheduleMatchData !== 'null'
    ? JSON.parse(scheduleMatchData)
    : null;

  const kickoffUTC = storedMatch?.utcDate || null;

  // ── Check send window ─────────────────────────────────────────────────────
  if (!isWithinWindow(scheduleSendTime, scheduleHasMatch === 'true', kickoffUTC)) {
    console.log(`⏩ Outside send window (opens at ${scheduleSendTime}, now ${fmtTime({ hour, minute })}). Exiting.`);
    return;
  }

  // ── Send the message ──────────────────────────────────────────────────────
  console.log('⏰ Within send window — sending message!');

  if (scheduleHasMatch === 'true') {
    if (storedMatch) {
      await sendMatchReminder(storedMatch, new Date(storedMatch.utcDate));
    } else {
      console.log('⚠️  Match data missing from variables. Exiting without sending.');
      return;
    }
  } else {
    await sendNoMatchMessage(storedMatch);
  }

  await setVariable('SCHEDULE_SENT', 'true');
  console.log('✅ Message sent and marked as sent for today.');
}

run().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});