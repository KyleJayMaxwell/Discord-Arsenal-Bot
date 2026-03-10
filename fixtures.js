const axios = require('axios');

const ARSENAL_TEAM_ID = 57;
const API_BASE = 'https://api.football-data.org/v4';

async function getUpcomingMatch() {
  const today = new Date();
  const twoDaysLater = new Date(today);
  twoDaysLater.setDate(today.getDate() + 2);

  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = twoDaysLater.toISOString().split('T')[0];

  const response = await axios.get(
    `${API_BASE}/teams/${ARSENAL_TEAM_ID}/matches`,
    {
      headers: { 'X-Auth-Token': process.env.FOOTBALL_API_KEY },
      params: {
        status: 'SCHEDULED',
        dateFrom,
        dateTo,
      },
    }
  );

  const matches = response.data.matches;
  if (!matches || matches.length === 0) return null;

  return matches[0];
}

module.exports = { getUpcomingMatch };