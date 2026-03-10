const axios = require('axios');

/**
 * Sends a match reminder to the Discord channel via webhook.
 */
async function sendMatchReminder(match, kickoffPST) {
  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
  const competition = match.competition.name;

  const isHomeGame = match.homeTeam.id === 57;
  // Use the venue from the API if available, otherwise fall back to the home team's name
  const venue = isHomeGame
    ? 'Emirates Stadium'
    : (match.venue || `${home} Ground`);

  const timeStr = kickoffPST.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    hour12: true,
  });

  const dateStr = kickoffPST.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  const message = {
    username: 'Arsenal Match Bot',
    // PNG version of the Arsenal crest — Discord doesn't support SVG avatars
    avatar_url: 'https://resources.premierleague.com/premierleague/badges/t3.png',
    embeds: [
      {
        color: 0xef0107, // Arsenal red
        title: `⚽ Arsenal Match Reminder`,
        description: `**${home} vs ${away}**`,
        fields: [
          { name: '🏆 Competition', value: competition, inline: true },
          { name: '🏟️ Venue', value: venue, inline: true },
          { name: '📅 Date', value: dateStr, inline: false },
          { name: '⏰ Kickoff (PST)', value: timeStr, inline: true },
        ],
        footer: { text: 'Come on you Gunners! 🔴' },
      },
    ],
  };

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, message);
    console.log(`✅ Reminder sent for: ${home} vs ${away}`);
  } catch (err) {
    console.error('❌ Discord error status:', err.response?.status);
    console.error('❌ Discord error body:', JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

module.exports = { sendMatchReminder };
