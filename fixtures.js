/**
 * fixtures.js
 *
 * Fetches Arsenal's match schedule from the football-data.org API.
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
 * Shared helper — fetches Arsenal matches between two dates.
 *
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo   - YYYY-MM-DD
 * @returns {Array}         - Array of match objects, may be empty
 */
async function fetchMatches(dateFrom, dateTo) {
  const response = await axios.get(
    `${API_BASE}/teams/${ARSENAL_TEAM_ID}/matches`,
    {
      headers: {
        // Stored in .env locally, GitHub Secrets in production
        'X-Auth-Token': process.env.FOOTBALL_API_KEY,
      },
      params: {
        status: 'SCHEDULED',
        dateFrom,
        dateTo,
      },
    }
  );
  return response.data.matches || [];
}

/**
 * Returns today's Arsenal match, or null if there isn't one.
 *
 * Only looks at today's date — the new reminder logic only needs
 * to know if Arsenal play today, not days ahead.
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
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const matches = await fetchMatches(today, today);

  // Return today's match, or null if Arsenal aren't playing today
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Returns the next scheduled Arsenal match within the next 60 days.
 *
 * Used to show a countdown on days when Arsenal aren't playing.
 * 60 days is enough to cover any international break or fixture gap.
 *
 * Returns null if nothing is found (very unlikely mid-season).
 */
async function getNextMatch() {
  const today = new Date();
  const sixtyDaysLater = new Date(today);
  sixtyDaysLater.setDate(today.getDate() + 60);

  const dateFrom = today.toISOString().split('T')[0];
  const dateTo   = sixtyDaysLater.toISOString().split('T')[0];

  const matches = await fetchMatches(dateFrom, dateTo);

  return matches.length > 0 ? matches[0] : null;
}

module.exports = { getUpcomingMatch, getNextMatch };