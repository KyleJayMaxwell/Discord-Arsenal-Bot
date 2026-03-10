require('dotenv').config();
const { getUpcomingMatch } = require('./fixtures');
const { sendMatchReminder } = require('./discord');

// Validate required env vars
const required = ['FOOTBALL_API_KEY', 'DISCORD_WEBHOOK_URL'];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('your_')) {
    console.error(`❌ Missing or unconfigured environment variable: ${key}`);
    process.exit(1);
  }
}

/**
 * Determines if a match kickoff is before 7am PST.
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

async function run() {
  const arg = process.argv[2]; // 'morning', 'evening', or 'test-webhook'

  console.log(`🔍 Running in mode: ${arg || 'morning'}`);

  try {
    const match = await getUpcomingMatch();

    if (!match) {
      console.log('No upcoming Arsenal matches in the next 2 days.');
      return;
    }

    console.log(`📅 Next match: ${match.homeTeam.name} vs ${match.awayTeam.name}`);

    // test-webhook: bypass all logic and send immediately
    if (arg === 'test-webhook') {
      await sendMatchReminder(match, new Date(match.utcDate));
      console.log('✅ Test webhook sent!');
      return;
    }

    const matchDatePST = getPSTDateString(match.utcDate);
    const today = getTodayPST();
    const tomorrow = getTomorrowPST();
    const earlyKickoff = isEarlyKickoff(match.utcDate);

    const isMorning = arg === 'morning' || !arg;
    const isEvening = arg === 'evening';

    const shouldSendMorning = isMorning && matchDatePST === today && !earlyKickoff;
    const shouldSendEvening = isEvening && matchDatePST === tomorrow && earlyKickoff;

    if (shouldSendMorning || shouldSendEvening) {
      await sendMatchReminder(match, new Date(match.utcDate));
    } else {
      console.log('No reminder needed right now.');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

run();
