/**
 * index.js
 *
 * Entry point for the Arsenal Match Reminder bot.
 *
 * This script runs once per hour via GitHub Actions and exits immediately.
 * It checks whether Arsenal play today, and if so, whether now is the
 * right time to send the reminder. DST is handled automatically by using
 * the 'America/Los_Angeles' timezone throughout.
 *
 * ─────────────────────────────────────────────────────
 * REMINDER LOGIC
 * ─────────────────────────────────────────────────────
 * The workflow runs every 30 minutes. Each run checks:
 *
 *   Arsenal play today?
 *   ├── YES → Kickoff at 7:30am or later?
 *   │         ├── YES → Send reminder at 7:00am
 *   │         └── NO  → Send reminder 30 mins before kickoff
 *   └── NO  → Send "no match today" message with countdown at 7:00am
 *
 * ─────────────────────────────────────────────────────
 * CLI USAGE
 * ─────────────────────────────────────────────────────
 *   node index.js              → Normal run (used by GitHub Actions cron)
 *   node index.js test-webhook → Bypass all logic, send immediately
 *
 * ─────────────────────────────────────────────────────
 * CONFIGURATION
 * ─────────────────────────────────────────────────────
 * EARLIEST_SEND_HOUR / MINUTE — earliest the reminder will ever fire (default 7:00 AM)
 * REMINDER_OFFSET_MINS        — how many minutes before kickoff to send (default 30)
 *
 * To change these, update the constants below. No workflow changes needed.
 */

require('dotenv').config();
const { getUpcomingMatch, getNextMatch } = require('./fixtures');
const { sendMatchReminder, sendNoMatchMessage } = require('./discord');

// ─────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────

// The time reminders are sent for games at or after LATE_KICKOFF_HOUR:MINUTE
const EARLIEST_SEND_HOUR   = 7;
const EARLIEST_SEND_MINUTE = 0;

// Games kicking off at or after this time get a 7am reminder instead of 30-mins-before
// e.g. a 12:30pm game → remind at 7am, not 12:00pm
const LATE_KICKOFF_HOUR   = 7;
const LATE_KICKOFF_MINUTE = 30;

// How many minutes before kickoff to send the reminder (only for early kickoffs)
const REMINDER_OFFSET_MINS = 30;

// ─────────────────────────────────────────────────────
// Environment variable validation
// Fails fast on startup so errors are obvious, not silent
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
// Helper: Get the current time in Los Angeles
//
// Returns a plain object with hour and minute as integers.
// Using 'America/Los_Angeles' means DST is handled automatically by Node —
// no manual UTC offset adjustments needed.
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

// ─────────────────────────────────────────────────────
// Helper: Convert total minutes-since-midnight to { hour, minute }
// ─────────────────────────────────────────────────────
function minsToTime(totalMins) {
  return {
    hour: Math.floor(totalMins / 60),
    minute: totalMins % 60,
  };
}

// ─────────────────────────────────────────────────────
// Helper: Calculate what time the reminder should fire for a given kickoff
//
// Rule:
//   - Kickoff at 7:30am or later → remind at 7:00am
//   - Kickoff before 7:30am      → remind 30 mins before kickoff
//
// Examples:
//   Kickoff 12:30 PM → remind at  7:00 AM  (at or after 7:30am threshold)
//   Kickoff  7:30 AM → remind at  7:00 AM  (exactly at threshold)
//   Kickoff  6:00 AM → remind at  5:30 AM  (before threshold, 30 mins early)
//   Kickoff  3:00 AM → remind at  2:30 AM  (very early, 30 mins early)
//
// Returns { hour, minute } in LA time.
// ─────────────────────────────────────────────────────
function calcReminderTime(kickoffUTC) {
  const kickoff = new Date(kickoffUTC);

  const kickoffHour = parseInt(
    kickoff.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' })
  );
  const kickoffMinute = parseInt(
    kickoff.toLocaleString('en-US', { minute: '2-digit', timeZone: 'America/Los_Angeles' })
  );

  const kickoffTotalMins    = kickoffHour * 60 + kickoffMinute;
  const lateKickoffThreshold = LATE_KICKOFF_HOUR * 60 + LATE_KICKOFF_MINUTE;

  if (kickoffTotalMins >= lateKickoffThreshold) {
    // Game is at 7:30am or later — always remind at 7:00am
    return { hour: EARLIEST_SEND_HOUR, minute: EARLIEST_SEND_MINUTE };
  } else {
    // Game is before 7:30am — remind 30 mins before kickoff
    return minsToTime(kickoffTotalMins - REMINDER_OFFSET_MINS);
  }
}

// ─────────────────────────────────────────────────────
// Helper: Check if the current LA time matches the reminder time for a match
//
// GitHub Actions runs at :30 past each hour. We check if the current
// hour and minute match the calculated send time for today's match.
// ─────────────────────────────────────────────────────
function isReminderTime(kickoffUTC) {
  const { hour: currentHour, minute: currentMinute } = getCurrentLATime();
  const { hour: sendHour,    minute: sendMinute    } = calcReminderTime(kickoffUTC);

  return currentHour === sendHour && currentMinute === sendMinute;
}

// ─────────────────────────────────────────────────────
// Helper: Get today's date as YYYY-MM-DD in LA time
//
// We use 'en-CA' locale because it naturally produces YYYY-MM-DD,
// making date comparisons simple and unambiguous.
// ─────────────────────────────────────────────────────
function getTodayLA() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// ─────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────
async function run() {
  const isTest = process.argv[2] === 'test-webhook';
  const { hour, minute } = getCurrentLATime();
  const timeStr = `${hour}:${String(minute).padStart(2, '0')}`;

  console.log(`🕐 Current LA time: ${timeStr}`);

  try {
    // Check if Arsenal play in the next 2 days (today or tomorrow for early kickoffs)
    const match = await getUpcomingMatch();

    // ── Test mode ──────────────────────────────────────
    // Bypass all time/date checks and send immediately.
    // If there's a match coming up send the match card,
    // otherwise send the no-match countdown card.
    if (isTest) {
      if (match) {
        console.log(`🧪 Test mode — sending match reminder for: ${match.homeTeam.name} vs ${match.awayTeam.name}`);
        await sendMatchReminder(match, new Date(match.utcDate));
      } else {
        console.log('🧪 Test mode — no imminent match, sending no-match message...');
        const nextMatch = await getNextMatch();
        await sendNoMatchMessage(nextMatch);
      }
      console.log('✅ Test message sent! Check your Discord channel.');
      return;
    }

    // ── Scheduled run ──────────────────────────────────
    const today = getTodayLA();
    const matchIsToday = match && match.utcDate.startsWith(today);

    if (matchIsToday) {
      // Arsenal play today — check if now is the right time to send the reminder
      const reminderTime = calcReminderTime(match.utcDate);
      console.log(`📅 Arsenal play today. Reminder scheduled for ${reminderTime.hour}:${String(reminderTime.minute).padStart(2, '0')} LA time.`);

      if (isReminderTime(match.utcDate)) {
        console.log('⏰ It\'s reminder time — sending match alert!');
        await sendMatchReminder(match, new Date(match.utcDate));
      } else {
        console.log(`⏩ Not reminder time yet (${timeStr}). Exiting.`);
      }
    } else {
      // No match today — send the no-match message with a countdown to the next fixture.
      // This fires once per day at 7:00 AM (the earliest send time), since that's
      // when the hourly cron first runs on a no-match day.
      if (hour === EARLIEST_SEND_HOUR && minute === EARLIEST_SEND_MINUTE) {
        console.log('No match today. Sending countdown message...');
        const nextMatch = await getNextMatch();
        await sendNoMatchMessage(nextMatch);
      } else {
        console.log(`⏩ No match today and not 7:00 AM yet (${timeStr}). Exiting.`);
      }
    }

  } catch (err) {
    console.error('❌ Unexpected error:', err.message);
    process.exit(1); // Non-zero exit marks the GitHub Actions run as failed
  }
}

run();