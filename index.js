/**
 * index.js
 *
 * Entry point for the Arsenal Match Reminder bot.
 *
 * This script is designed to be run once and exit — it is NOT a long-running
 * server process. GitHub Actions triggers it on a schedule (see
 * .github/workflows/arsenal-reminder.yml), runs the logic, and shuts it down.
 *
 * ─────────────────────────────────────────────────────
 * REMINDER LOGIC
 * ─────────────────────────────────────────────────────
 * Morning run (7:30 AM PST):
 *   → If Arsenal play TODAY and kickoff is at/after 7:30am PST → send reminder
 *
 * Evening run (5:00 PM PST):
 *   → If Arsenal play TOMORROW and kickoff is before 7:30am PST → send reminder
 *     (early kickoffs are typically European away games, e.g. 12:45pm CET = 3:45am PST)
 *
 * ─────────────────────────────────────────────────────
 * RUN MODES (passed as a CLI argument)
 * ─────────────────────────────────────────────────────
 *   node index.js morning       → Run the 7:30am logic
 *   node index.js evening       → Run the 5:00pm logic
 *   node index.js test-webhook  → Skip all date logic, send reminder immediately
 *
 * GitHub Actions passes 'morning' or 'evening' automatically based on
 * which cron schedule triggered the run.
 */

require('dotenv').config(); // Loads .env file when running locally
const { getUpcomingMatch } = require('./fixtures');
const { sendMatchReminder } = require('./discord');

// ─────────────────────────────────────────────────────
// Environment variable validation
// Fails fast on startup if keys are missing or unconfigured,
// rather than hitting an error mid-run.
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
// Helper: Determine if a match kickoff is before 7:30am PST
//
// Used to decide which reminder window applies:
//   - Before 7:30am → evening reminder the day before
//   - At/after 7:30am → morning reminder on match day
//
// To change the cutoff time, update both the hour/minute
// comparison below AND the cron schedules in arsenal-reminder.yml
// ─────────────────────────────────────────────────────
function isEarlyKickoff(kickoffUTC) {
  const date = new Date(kickoffUTC);

  const kickoffHourPST = parseInt(
    date.toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/Los_Angeles',
    })
  );

  const kickoffMinutePST = parseInt(
    date.toLocaleString('en-US', {
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    })
  );

  // Returns true if kickoff is before 7:30am PST
  return kickoffHourPST < 7 || (kickoffHourPST === 7 && kickoffMinutePST < 30);
}

// ─────────────────────────────────────────────────────
// Helper: Date string utilities (all in PST)
//
// We use 'en-CA' locale because it produces YYYY-MM-DD format,
// which makes date comparisons simple and unambiguous.
// ─────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD in PST */
function getTodayPST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** Returns tomorrow's date as YYYY-MM-DD in PST */
function getTomorrowPST() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** Converts any UTC date string to YYYY-MM-DD in PST */
function getPSTDateString(utcDate) {
  return new Date(utcDate).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// ─────────────────────────────────────────────────────
// Main run function
// ─────────────────────────────────────────────────────
async function run() {
  const mode = process.argv[2]; // 'morning', 'evening', or 'test-webhook'

  console.log(`🔍 Running in mode: ${mode || 'morning'}`);

  try {
    const match = await getUpcomingMatch();

    if (!match) {
      // No match in the next 2 days — nothing to do, exit cleanly
      console.log('No upcoming Arsenal matches in the next 2 days. No reminder sent.');
      return;
    }

    console.log(`📅 Next match found: ${match.homeTeam.name} vs ${match.awayTeam.name} on ${match.utcDate}`);

    // test-webhook mode: skip all date/time logic and send the reminder immediately.
    // Use this to verify your webhook URL and message formatting are working.
    if (mode === 'test-webhook') {
      await sendMatchReminder(match, new Date(match.utcDate));
      console.log('✅ Test webhook sent! Check your Discord channel.');
      return;
    }

    // Compare match date (in PST) against today/tomorrow to decide if a reminder is due
    const matchDatePST = getPSTDateString(match.utcDate);
    const today = getTodayPST();
    const tomorrow = getTomorrowPST();
    const earlyKickoff = isEarlyKickoff(match.utcDate);

    const isMorning = mode === 'morning' || !mode;
    const isEvening = mode === 'evening';

    // Morning condition: match is today AND kickoff is at/after 7:30am PST
    const shouldSendMorning = isMorning && matchDatePST === today && !earlyKickoff;

    // Evening condition: match is tomorrow AND kickoff is before 7:30am PST
    const shouldSendEvening = isEvening && matchDatePST === tomorrow && earlyKickoff;

    if (shouldSendMorning || shouldSendEvening) {
      await sendMatchReminder(match, new Date(match.utcDate));
    } else {
      console.log('Conditions not met for a reminder right now. No message sent.');
    }

  } catch (err) {
    console.error('❌ Unexpected error:', err.message);
    process.exit(1); // Non-zero exit code marks the GitHub Actions run as failed
  }
}

run();