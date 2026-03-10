const cron = require('node-cron');
const { getUpcomingMatch } = require('./fixtures');
const { sendMatchReminder } = require('./discord');

// Track which match IDs we've already sent reminders for, to avoid duplicates
const sentReminders = new Set();

/**
 * Determines if a match kickoff is before 7am PST on the same day.
 */
function isEarlyKickoff(kickoffUTC) {
  const kickoffHourPST = parseInt(
    new Date(kickoffUTC).toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/Los_Angeles',
    })
  );
  return kickoffHourPST < 7;
}

/**
 * Gets a YYYY-MM-DD date string in PST for a given UTC date.
 */
function getPSTDateString(utcDate) {
  return new Date(utcDate).toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
}

function getTodayPST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function getTomorrowPST() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function getCurrentHourPST() {
  return parseInt(
    new Date().toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/Los_Angeles',
    })
  );
}

/**
 * Main hourly check — runs every hour and applies the reminder logic:
 *   - Match today + kickoff at/after 7am PST  → remind at 7am PST
 *   - Match tomorrow + kickoff before 7am PST → remind at 5pm PST
 */
async function hourlyCheck() {
  const currentHour = getCurrentHourPST();
  console.log(`⏰ Hourly check running... (Current hour PST: ${currentHour}:00)`);

  try {
    const match = await getUpcomingMatch();
    if (!match) return console.log('No upcoming matches found.');

    const matchDatePST = getPSTDateString(match.utcDate);
    const today = getTodayPST();
    const tomorrow = getTomorrowPST();
    const earlyKickoff = isEarlyKickoff(match.utcDate);

    // Determine if we should send a reminder this hour
    const shouldSendMorning = matchDatePST === today && !earlyKickoff && currentHour === 7;
    const shouldSendEvening = matchDatePST === tomorrow && earlyKickoff && currentHour === 17;

    if (shouldSendMorning || shouldSendEvening) {
      // Avoid sending duplicate reminders for the same match
      if (sentReminders.has(match.id)) {
        return console.log(`Reminder already sent for match ${match.id}, skipping.`);
      }

      await sendMatchReminder(match, new Date(match.utcDate));
      sentReminders.add(match.id);
    } else {
      console.log('No reminder needed this hour.');
    }
  } catch (err) {
    console.error('Error in hourly check:', err.message);
  }
}

function startScheduler() {
  // Run at the top of every hour
  cron.schedule('0 * * * *', hourlyCheck, { timezone: 'America/Los_Angeles' });

  console.log('🤖 Arsenal bot scheduler started!');
  console.log('   → Checking every hour (PST)');
  console.log('   → Will remind at 7am for same-day games (kickoff after 7am)');
  console.log('   → Will remind at 5pm for next-day early games (kickoff before 7am)');
}

module.exports = { startScheduler, hourlyCheck };
