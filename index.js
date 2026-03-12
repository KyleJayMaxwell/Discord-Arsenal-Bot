/**
 * index.js
 *
 * Arsenal Match Reminder — entry point.
 *
 * Runs every 30 minutes via GitHub Actions. Uses two environment variables
 * stored as GitHub Actions Variables (not secrets) to persist state across
 * runs within the same day:
 *
 *   SCHEDULE_SEND_TIME  — "HH:MM" string set at 3am, e.g. "07:00" or "06:30"
 *   SCHEDULE_SENT       — "true" once the message has been sent today
 *   SCHEDULE_DATE       — "YYYY-MM-DD" the date the schedule was built for
 *
 * These are written back via the GitHub API after each relevant run.
 *
 * ─────────────────────────────────────────────────────
 * FLOW
 * ─────────────────────────────────────────────────────
 *
 *   Every 30 min run:
 *   ├── Is it the 3am window AND schedule is stale (not from today)?
 *   │   └── YES → Call football API, calculate send time, save to GitHub vars
 *   ├── Is SCHEDULE_SENT already "true" for today?
 *   │   └── YES → Exit (message already sent today)
 *   └── Is current time within the send window?
 *       ├── YES → Send message, set SCHEDULE_SENT=true
 *       └── NO  → Exit silently
 *
 * ─────────────────────────────────────────────────────
 * SEND TIME RULES
 * ─────────────────────────────────────────────────────
 *   Game today, kickoff at/after 7:30am → send at 7:00am
 *   Game today, kickoff before 7:30am   → send 30 mins before kickoff
 *   No game today                       → send at 6:30am
 *
 * A 29-minute buffer handles GitHub Actions scheduling delays.
 *
 * ─────────────────────────────────────────────────────
 * CLI USAGE
 * ─────────────────────────────────────────────────────
 *   node index.js          → Normal scheduled run
 *   node index.js test-webhook → Bypass all logic, send immediately
 *
 * ─────────────────────────────────────────────────────
 * REQUIRED ENV VARS (GitHub Secrets)
 * ─────────────────────────────────────────────────────
 *   FOOTBALL_API_KEY      → football-data.org API key
 *   DISCORD_WEBHOOK_URL   → Discord channel webhook URL
 *   GH_TOKEN              → GitHub token with repo variable write access
 *                           (use the auto-provided GITHUB_TOKEN in the workflow)
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
const EARLIEST_SEND_HOUR   = 7;    // Match reminders never fire before 7:00am
const EARLIEST_SEND_MINUTE = 0;
const LATE_KICKOFF_HOUR    = 7;    // Kickoffs at/after 7:30am → remind at 7:00am
const LATE_KICKOFF_MINUTE  = 30;
const REMINDER_OFFSET_MINS = 30;   // Mins before kickoff for early games
const NO_MATCH_SEND_HOUR   = 6;    // No-match message time
const NO_MATCH_SEND_MINUTE = 30;
const CHECK_HOUR           = 3;    // When to call the API and set the schedule (3am)
const CHECK_MINUTE         = 0;
const WINDOW_MINS          = 29;   // Tolerance for GitHub Actions delays

// ─────────────────────────────────────────────────────
// Environment variable validation
// ─────────────────────────────────────────────────────
const required = ['FOOTBALL_API_KEY', 'DISCORD_WEBHOOK_URL'];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('your_')) {
    console.error(`❌ Missing or unconfigured environment variable: ${key}`);
    console.error('   → Locally: copy .env.example to .env and fill in your values');
    console.error('   → Production: add the secret in GitHub repo Settings → Secrets');
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

/** Converts total minutes since midnight to { hour, minute }. */
function fromMins(totalMins) {
  return { hour: Math.floor(totalMins / 60), minute: totalMins % 60 };
}

/** Formats { hour, minute } as "H:MM" for logging. */
function fmtTime({ hour, minute }) {
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

/**
 * Calculates what time the reminder should fire for a given kickoff.
 *
 *   Kickoff at/after 7:30am → send at 7:00am
 *   Kickoff before 7:30am   → send 30 mins before kickoff
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
  const earliestMins  = EARLIEST_SEND_HOUR * 60 + EARLIEST_SEND_MINUTE;

  if (kickoffMins >= lateThreshold) {
    return fromMins(earliestMins); // 7:00am
  } else {
    return fromMins(kickoffMins - REMINDER_OFFSET_MINS); // 30 mins before kickoff
  }
}

/**
 * Returns true if the current LA time falls within the send window.
 * Window = [sendTime, sendTime + WINDOW_MINS)
 */
function isWithinWindow(sendTimeStr) {
  const [sendHour, sendMinute] = sendTimeStr.split(':').map(Number);
  const currentMins = toMins(getCurrentLATime());
  const sendMins    = toMins({ hour: sendHour, minute: sendMinute });
  return currentMins >= sendMins && currentMins < sendMins + WINDOW_MINS;
}

// ─────────────────────────────────────────────────────
// GitHub Variables API
// Reads and writes repository variables to persist schedule state
// across runs. Variables are stored under the repo's Actions variables.
//
// Required: GH_TOKEN env var with repo write access
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
    if (err.response?.status === 404) return null; // Variable doesn't exist yet — expected on first run
    throw err; // Surface real errors (bad token, network failure, etc.)
  }
}

async function setVariable(name, value) {
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const body    = { name, value: String(value) };

  try {
    // Always try PATCH first (variable already exists)
    await axios.patch(
      `${GH_API}/repos/${process.env.GITHUB_REPOSITORY}/actions/variables/${name}`,
      body, { headers }
    );
  } catch (err) {
    if (err.response?.status === 404) {
      // Variable doesn't exist yet — create it
      await axios.post(
        `${GH_API}/repos/${process.env.GITHUB_REPOSITORY}/actions/variables`,
        body, { headers }
      );
    } else throw err;
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
  const scheduleDate     = await getVariable('SCHEDULE_DATE');
  const scheduleSendTime = await getVariable('SCHEDULE_SEND_TIME');
  const scheduleSent     = await getVariable('SCHEDULE_SENT');
  const scheduleHasMatch = await getVariable('SCHEDULE_HAS_MATCH');
  // SCHEDULE_MATCH_DATA is read later only if we're in the send window

  const scheduleIsStale  = scheduleDate !== today;

  console.log(`📋 Schedule: date=${scheduleDate}, sendTime=${scheduleSendTime}, sent=${scheduleSent}, hasMatch=${scheduleHasMatch}, stale=${scheduleIsStale}`);

  // ── 3am check window: refresh the schedule if it's stale ──────────────────
  const currentMins  = toMins({ hour, minute });
  const checkMins    = toMins({ hour: CHECK_HOUR, minute: CHECK_MINUTE });
  const inCheckWindow = currentMins >= checkMins && currentMins < checkMins + WINDOW_MINS;

  if (scheduleIsStale && inCheckWindow) {
    console.log('🔍 3am window — fetching today\'s fixtures and setting schedule...');

    const match = await getUpcomingMatch();

    let sendTime;
    let hasMatch;

    if (match) {
      sendTime = calcSendTime(match.utcDate);
      hasMatch = true;
      console.log(`📅 Arsenal play today: ${match.homeTeam.name} vs ${match.awayTeam.name}`);
      console.log(`⏰ Reminder will send at ${fmtTime(sendTime)} LA time`);
    } else {
      sendTime = { hour: NO_MATCH_SEND_HOUR, minute: NO_MATCH_SEND_MINUTE };
      hasMatch = false;
      console.log(`💤 No match today. No-match message will send at ${fmtTime(sendTime)} LA time`);
    }

    // Store the full match data now so send time requires zero API calls.
    // For no-match days we store the next upcoming fixture for the countdown.
    const nextMatch = hasMatch ? null : await getNextMatch();
    const rawMatch  = hasMatch ? match : nextMatch;

    // Only store the fields discord.js actually uses — keeps the payload
    // small and well under GitHub Variables' 48KB limit
    const matchData = rawMatch ? {
      utcDate:     rawMatch.utcDate,
      venue:       rawMatch.venue,
      competition: { name: rawMatch.competition.name },
      homeTeam:    { id: rawMatch.homeTeam.id, name: rawMatch.homeTeam.name },
      awayTeam:    { id: rawMatch.awayTeam.id, name: rawMatch.awayTeam.name },
    } : null;
    const matchJSON = matchData ? JSON.stringify(matchData) : 'null';

    // Persist everything to GitHub Variables for subsequent runs today
    await setVariable('SCHEDULE_DATE',       today);
    await setVariable('SCHEDULE_SEND_TIME',  fmtTime(sendTime));
    await setVariable('SCHEDULE_HAS_MATCH',  String(hasMatch));
    await setVariable('SCHEDULE_MATCH_DATA', matchJSON);
    await setVariable('SCHEDULE_SENT',       'false');

    console.log('✅ Schedule saved to GitHub Variables. No further API calls needed today.');
    return; // Don't send yet — let the next run handle it at the right time
  }

  // ── If schedule is still stale outside the check window, skip ────────────
  if (scheduleIsStale) {
    console.log('⏩ Schedule is stale but outside the 3am check window. Exiting.');
    return;
  }

  // ── Already sent today — nothing to do ───────────────────────────────────
  if (scheduleSent === 'true') {
    console.log('✅ Message already sent today. Exiting.');
    return;
  }

  // ── Check if we're in the send window ─────────────────────────────────────
  if (!isWithinWindow(scheduleSendTime)) {
    console.log(`⏩ Outside send window (send at ${scheduleSendTime}, now ${fmtTime({ hour, minute })}). Exiting.`);
    return;
  }

  // ── Send the message ──────────────────────────────────────────────────────
  console.log(`⏰ Within send window — sending message!`);

  // Use the match data stored at 3am — no API call needed
  const scheduleMatchData = await getVariable('SCHEDULE_MATCH_DATA');
  const storedMatch = scheduleMatchData && scheduleMatchData !== 'null'
    ? JSON.parse(scheduleMatchData)
    : null;

  if (scheduleHasMatch === 'true') {
    if (storedMatch) {
      await sendMatchReminder(storedMatch, new Date(storedMatch.utcDate));
    } else {
      // Shouldn't happen, but fall back gracefully if data is missing
      console.log('⚠️  Match data missing from variables. Exiting without sending.');
      return;
    }
  } else {
    // storedMatch here is the next upcoming fixture for the countdown
    await sendNoMatchMessage(storedMatch);
  }

  // Mark as sent so no further runs today will fire
  await setVariable('SCHEDULE_SENT', 'true');
  console.log('✅ Message sent and marked as sent for today.');
}

run().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});