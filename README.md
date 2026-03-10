# ⚽ Arsenal Match Reminder Bot

Posts a Discord reminder before every Arsenal FC match via webhook.

- **Game at or after 7am PST** → reminder posted at **7:00 AM PST** that day
- **Game before 7am PST** → reminder posted at **5:00 PM PST** the day before

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Get a free football API key
Sign up at [football-data.org](https://www.football-data.org/client/register) — it's free, no credit card needed.

### 3. Create a Discord Webhook
1. Open your Discord server
2. Go to **Server Settings → Integrations → Webhooks**
3. Click **New Webhook**, choose your channel, copy the URL

### 4. Configure your environment
```bash
cp .env.example .env
```
Then edit `.env` and fill in your keys:
```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
FOOTBALL_API_KEY=your_key_here
```

### 5. Run the bot
```bash
npm start
```

---

## Hosting (keep it running 24/7)

| Option | Cost | Notes |
|---|---|---|
| [Railway](https://railway.app) | Free tier available | Easiest, deploy from GitHub |
| [Fly.io](https://fly.io) | Free tier available | Good free option |
| VPS (DigitalOcean, Linode) | ~$4-6/mo | Full control |
| Home server / Raspberry Pi | Free | Needs to stay on |

For Railway/Fly.io, push this folder to a GitHub repo and connect it — they'll auto-detect the `npm start` script.

---

## File Structure

```
arsenal-bot/
├── index.js       # Cron jobs (7am + 5pm PST schedulers)
├── fixtures.js    # Fetches Arsenal fixtures from football-data.org
├── discord.js     # Builds and sends Discord webhook messages
├── .env           # Your secrets (never commit this!)
├── .env.example   # Template for .env
└── package.json
```
