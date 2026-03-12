/**
 * discord.js
 *
 * Handles formatting and sending messages to Discord via webhook.
 *
 * Discord webhook docs: https://discord.com/developers/docs/resources/webhook
 * Discord embed reference: https://discord.com/developers/docs/resources/message#embed-object
 *
 * Two message types:
 *   sendMatchReminder()  — Arsenal play today, here are the details
 *   sendNoMatchMessage() — No game today, here's when the next one is
 */

const axios = require('axios');

// Arsenal's team ID — used to determine if a match is home or away
const ARSENAL_TEAM_ID = 57;

/**
 * Formats and sends a match reminder embed to the Discord channel.
 *
 * @param {object} match      - Match object from the football-data.org API
 * @param {Date}   kickoffUTC - Kickoff time as a JS Date (displayed in LA time)
 */
async function sendMatchReminder(match, kickoffUTC) {
  const home        = match.homeTeam.name;
  const away        = match.awayTeam.name;
  const competition = match.competition.name;

  // Determine venue:
  // - Home game → always Emirates Stadium
  // - Away game → use venue from API if available, otherwise fall back to a generic label
  const isHomeGame = match.homeTeam.id === ARSENAL_TEAM_ID;
  const venue = isHomeGame
    ? 'Emirates Stadium'
    : match.venue || `${home} Ground`;

  // Format times in LA time (handles PST/PDT automatically)
  const timeStr = kickoffUTC.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    hour12: true,
  });

  const dateStr = kickoffUTC.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  const message = {
    username: 'Arsenal Match Bot',
    // Discord does not support SVG avatars — must be PNG or JPG
    avatar_url: 'https://resources.premierleague.com/premierleague/badges/t3.png',
    embeds: [
      {
        color: 0xef0107, // Arsenal red
        title: '⚽ Arsenal Match Reminder',
        description: `**${home} vs ${away}**`,
        fields: [
          { name: '🏆 Competition',   value: competition, inline: true  },
          { name: '🏟️ Venue',        value: venue,       inline: true  },
          { name: '📅 Date',         value: dateStr,     inline: false },
          { name: '⏰ Kickoff (PST)', value: timeStr,     inline: true  },
        ],
        footer: { text: 'Come on you Gunners! 🔴' },
      },
    ],
  };

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, message);
    console.log(`✅ Match reminder sent: ${home} vs ${away}`);
  } catch (err) {
    // Log the full Discord error to help diagnose issues
    // Common causes: expired/invalid webhook URL, malformed payload
    console.error('❌ Discord error status:', err.response?.status);
    console.error('❌ Discord error body:', JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

/**
 * Sends a "no match today" message with a countdown to the next Arsenal fixture.
 *
 * @param {object|null} nextMatch - The next upcoming match from the API, or null if none found
 */
async function sendNoMatchMessage(nextMatch) {
  let description;
  let fields = [];

  if (nextMatch) {
    const now     = new Date();
    const kickoff = new Date(nextMatch.utcDate);

    // Calculate days until next match
    const msPerDay   = 1000 * 60 * 60 * 24;
    const daysUntil  = Math.ceil((kickoff - now) / msPerDay);
    const countdownText = daysUntil === 1 ? 'Tomorrow!' : `${daysUntil} days away`;

    const home        = nextMatch.homeTeam.name;
    const away        = nextMatch.awayTeam.name;
    const competition = nextMatch.competition.name;

    const isHomeGame = nextMatch.homeTeam.id === ARSENAL_TEAM_ID;
    const venue = isHomeGame ? 'Emirates Stadium' : nextMatch.venue || `${home} Ground`;

    const kickoffTimeStr = kickoff.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
      hour12: true,
    });

    const kickoffDateStr = kickoff.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Los_Angeles',
    });

    description = `No Arsenal match today. Next up: **${countdownText}**`;

    fields = [
      { name: '📋 Match',          value: `${home} vs ${away}`, inline: false },
      { name: '🏆 Competition',    value: competition,           inline: true  },
      { name: '🏟️ Venue',        value: venue,                 inline: true  },
      { name: '📅 Date',           value: kickoffDateStr,        inline: false },
      { name: '⏰ Kickoff (PST)',   value: kickoffTimeStr,        inline: true  },
    ];
  } else {
    // No fixtures found in the next 60 days — very unlikely but handled gracefully
    description = 'No Arsenal match today and no upcoming fixtures found. Check the schedule manually.';
  }

  const message = {
    username: 'Arsenal Match Bot',
    avatar_url: 'https://resources.premierleague.com/premierleague/badges/t3.png',
    embeds: [
      {
        color: 0x9e9e9e, // Grey — no match today
        title: '😴 No Match Today',
        description,
        fields,
        footer: { text: 'Come on you Gunners! 🔴' },
      },
    ],
  };

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, message);
    console.log('✅ No-match message sent.');
  } catch (err) {
    console.error('❌ Discord error status:', err.response?.status);
    console.error('❌ Discord error body:', JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

module.exports = { sendMatchReminder, sendNoMatchMessage };