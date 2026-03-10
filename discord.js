const axios = require("axios");

/**
 * Builds a rich Discord embed message for a match reminder.
 */
function buildMessage(match, isEarlyWarning = false) {
  const prefix = isEarlyWarning
    ? "⏰ **Early kickoff tomorrow — heads up!**"
    : "⚽ **Arsenal play today!**";

  const homeAway = match.isHome ? "🏠 Home" : "✈️ Away";
  const opponent = match.opponent;
  const matchup = match.isHome
    ? `Arsenal vs ${opponent}`
    : `${opponent} vs Arsenal`;

  // Discord embed object for a rich card
  return {
    username: "Arsenal Match Bot",
    avatar_url: "https://upload.wikimedia.org/wikipedia/en/5/53/Arsenal_FC.svg",
    embeds: [
      {
        title: `${prefix}`,
        color: 0xef0107, // Arsenal red
        fields: [
          {
            name: "Match",
            value: `**${matchup}**`,
            inline: false,
          },
          {
            name: "Competition",
            value: match.competition,
            inline: true,
          },
          {
            name: homeAway,
            value: match.venue,
            inline: true,
          },
          {
            name: "Kickoff",
            value: `${match.dateFormatted} at **${match.kickoffFormatted}**`,
            inline: false,
          },
        ],
        footer: {
          text: "Come on you Gunners! 🔴⚪",
        },
        thumbnail: {
          url: "https://upload.wikimedia.org/wikipedia/en/5/53/Arsenal_FC.svg",
        },
      },
    ],
  };
}

/**
 * Posts a match reminder to Discord via webhook.
 */
async function sendMatchReminder(match, isEarlyWarning = false) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl || webhookUrl.includes("YOUR_WEBHOOK")) {
    console.error("❌ DISCORD_WEBHOOK_URL is not set in your .env file.");
    return;
  }

  const payload = buildMessage(match, isEarlyWarning);

  await axios.post(webhookUrl, payload);
  console.log(
    `✅ Reminder sent for ${match.homeTeam} vs ${match.awayTeam} (${match.kickoffFormatted})`
  );
}

module.exports = { sendMatchReminder };
