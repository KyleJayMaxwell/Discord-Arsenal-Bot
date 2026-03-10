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

/**
 * Main check logic — shared between both cron jobs.
 * type: 'morning' (7:30am) or 'evening' (5:00pm)
 */
async function runCheck(type) {
  console.log(`⏰ Running ${type} check...`);

  try {
    const match = await getUpcomingMatch();
    if (!match) return console.log('No upcoming matches found.');

    const matchDatePST = getPSTDateString(match.utcDate);
    const today = getTodayPST();
    const tomorrow = getTomorrowPST();
    const earlyKickoff = isEarlyKickoff(match.utcDate);

    const shouldSendMorning = type === 'morning' && matchDatePST === today && !earlyKickoff;
    const shouldSendEvening = type === 'evening' && matchDatePST === tomorrow && earlyKickoff;

    if (shouldSendMorning || shouldSendEvening) {
      if (sentReminders.has(match.id)) {
        return console.log(`Reminder already sent for match ${match.id}, skipping.`);
      }
      await sendMatchReminder(match, new Date(match.utcDate));
      sentReminders.add(match.id);
    } else {
      console.log('No reminder needed right now.');
    }
  } catch (err) {
    console.error(`Error in ${type} check:`, err.message);
  }
}

function startScheduler() {
  // 7:30 AM PST daily — same-day games with kickoff at/after 7am
  cron.schedule('30 7 * * *', () => runCheck('morning'), { timezone: 'America/Los_Angeles' });

  // 5:00 PM PST daily — next-day early kickoff games (before 7am PST)
  cron.schedule('0 17 * * *', () => runCheck('evening'), { timezone: 'America/Los_Angeles' });

  console.log('🤖 Arsenal bot scheduler started!');
  console.log('   → Morning reminder: 7:30 AM PST daily');
  console.log('   → Evening reminder: 5:00 PM PST daily');
}

module.exports = { startScheduler, runCheck };
