/**
 * discord.js
 *
 * Handles formatting and sending the match reminder message
 * to Discord via a webhook URL.
 *
 * Discord webhook docs: https://discord.com/developers/docs/resources/webhook
 *
 * To update the message layout, edit the `embeds` array below.
 * Discord embed field reference: https://discord.com/developers/docs/resources/message#embed-object
 */

const axios = require('axios');

// Arsenal's team ID — used to determine if a match is home or away
const ARSENAL_TEAM_ID = 57;

/**
 * Formats and sends a match reminder embed to the Discord channel.
 *
 * @param {object} match       - Match object returned from the football-data.org API
 * @param {Date}   kickoffPST  - Kickoff time as a JS Date object (used for display formatting)
 */
async function sendMatchReminder(match, kickoffPST) {
  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
  const competition = match.competition.name;

  // Determine venue:
  // - If Arsenal are the home team, it's always the Emirates
  // - If away, use the venue field from the API (e.g. "BayArena")
  // - Fall back to a generic label if the API doesn't provide a venue name
  const isHomeGame = match.homeTeam.id === ARSENAL_TEAM_ID;
  const venue = isHomeGame
    ? 'Emirates Stadium'
    : match.venue || `${home} Ground`;

  // Format kickoff time as "3:00 PM" in PST
  const timeStr = kickoffPST.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    hour12: true,
  });

  // Format date as "Wednesday, March 11" in PST
  const dateStr = kickoffPST.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  // Discord webhook payload
  // "embeds" creates the rich card-style message in Discord
  const message = {
    username: 'Arsenal Match Bot',
    // Note: Discord does not support SVG avatars — must be PNG or JPG
    avatar_url: 'https://resources.premierleague.com/premierleague/badges/t3.png',
    embeds: [
      {
        color: 0xef0107, // Arsenal red (hex color for the left border of the embed)
        title: '⚽ Arsenal Match Reminder',
        description: `**${home} vs ${away}**`,
        fields: [
          { name: '🏆 Competition', value: competition, inline: true },
          { name: '🏟️ Venue',       value: venue,       inline: true },
          { name: '📅 Date',        value: dateStr,     inline: false },
          { name: '⏰ Kickoff (PST)', value: timeStr,   inline: true },
        ],
        footer: { text: 'Come on you Gunners! 🔴' },
      },
    ],
  };

  try {
    // POST the message payload to the Discord webhook URL
    await axios.post(process.env.DISCORD_WEBHOOK_URL, message);
    console.log(`✅ Reminder sent for: ${home} vs ${away}`);
  } catch (err) {
    // Log the full Discord error response to help debug issues
    // Common causes: invalid/expired webhook URL, malformed payload
    console.error('❌ Discord error status:', err.response?.status);
    console.error('❌ Discord error body:', JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

module.exports = { sendMatchReminder };