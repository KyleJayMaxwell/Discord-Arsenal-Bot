/**
 * fixtures.js
 *
 * Responsible for fetching Arsenal's upcoming match schedule
 * from the football-data.org API.
 *
 * API docs: https://www.football-data.org/documentation/quickstart
 * Arsenal's team ID in the API is 57.
 */

const axios = require('axios');

// Arsenal's ID in the football-data.org API — don't change this
const ARSENAL_TEAM_ID = 57;

// Base URL for all API requests
const API_BASE = 'https://api.football-data.org/v4';

/**
 * Fetches the next scheduled Arsenal match within the next 2 days.
 *
 * We look 2 days ahead so the evening check (5pm the day before)
 * can detect a match scheduled for the following day.
 *
 * Returns the match object if one is found, or null if Arsenal
 * aren't playing in the next 2 days.
 *
 * Example match object shape (abbreviated):
 * {
 *   id: 12345,
 *   utcDate: '2025-03-11T18:45:00Z',
 *   competition: { name: 'UEFA Champions League' },
 *   homeTeam: { id: 3, name: 'Bayer 04 Leverkusen' },
 *   awayTeam: { id: 57, name: 'Arsenal FC' },
 *   venue: 'BayArena'
 * }
 */
async function getUpcomingMatch() {
  const today = new Date();
  const twoDaysLater = new Date(today);
  twoDaysLater.setDate(today.getDate() + 2);

  // Format dates as YYYY-MM-DD for the API query params
  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = twoDaysLater.toISOString().split('T')[0];

  const response = await axios.get(
    `${API_BASE}/teams/${ARSENAL_TEAM_ID}/matches`,
    {
      headers: {
        // API key is stored in .env locally and as a GitHub Secret in production
        'X-Auth-Token': process.env.FOOTBALL_API_KEY,
      },
      params: {
        status: 'SCHEDULED', // Only fetch upcoming matches, not past results
        dateFrom,
        dateTo,
      },
    }
  );

  const matches = response.data.matches;

  // No matches in the next 2 days — return null so the caller can handle gracefully
  if (!matches || matches.length === 0) return null;

  // Matches are returned in chronological order — return the soonest one
  return matches[0];
}

module.exports = { getUpcomingMatch };