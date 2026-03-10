require('dotenv').config();
const { startScheduler, hourlyCheck } = require('./scheduler');

// Validate required env vars on startup
const required = ['FOOTBALL_API_KEY', 'DISCORD_WEBHOOK_URL'];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('your_')) {
    console.error(`❌ Missing or unconfigured environment variable: ${key}`);
    console.error('   Please copy .env.example to .env and fill in your values.');
    process.exit(1);
  }
}

// Allow manual test run via CLI: `node index.js test`
if (process.argv[2] === 'test') {
  console.log('🧪 Running manual hourly check test...');
  hourlyCheck().then(() => process.exit(0));
} else {
  startScheduler();
}
