require('dotenv').config();
const { startScheduler, runCheck } = require('./scheduler');
const { getUpcomingMatch } = require('./fixtures');
const { sendMatchReminder } = require('./discord');

// Validate required env vars on startup
const required = ['FOOTBALL_API_KEY', 'DISCORD_WEBHOOK_URL'];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('your_')) {
    console.error(`❌ Missing or unconfigured environment variable: ${key}`);
    console.error('   Please copy .env.example to .env and fill in your values.');
    process.exit(1);
  }
}

const arg = process.argv[2];

if (arg === 'test-webhook') {
  // Fetch next match and immediately send the reminder, bypassing time checks
  console.log('🧪 Fetching next Arsenal match and sending reminder now...');
  getUpcomingMatch()
    .then((match) => {
      if (!match) {
        console.log('❌ No upcoming matches found in the next 2 days.');
        process.exit(0);
      }
      console.log(`✅ Found match: ${match.homeTeam.name} vs ${match.awayTeam.name}`);
      return sendMatchReminder(match, new Date(match.utcDate));
    })
    .then(() => {
      console.log('✅ Webhook message sent! Check your Discord channel.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
} else if (arg === 'test-morning') {
  runCheck('morning').then(() => process.exit(0));
} else if (arg === 'test-evening') {
  runCheck('evening').then(() => process.exit(0));
} else {
  startScheduler();
}