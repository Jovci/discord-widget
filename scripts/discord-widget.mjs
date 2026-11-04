// Pushes the run streak, month distance and graph PNG to the Discord profile widget (Widgets V2, unofficial API).
// Reads out/discord-widget.json written by strava.mjs.
// Env: DISCORD_BOT_TOKEN, DISCORD_APP_ID, DISCORD_USER_ID, and DISCORD_GRAPH_URL or GITHUB_REPOSITORY
// Optional: DISCORD_USERNAME (default jovci)
import { readFile } from 'node:fs/promises';

const { DISCORD_BOT_TOKEN, DISCORD_APP_ID, DISCORD_USER_ID, GITHUB_REPOSITORY } = process.env;
if (!DISCORD_BOT_TOKEN) {
  console.log('DISCORD_BOT_TOKEN is not set; skipping the Discord widget update.');
  process.exit(0);
}
// In Actions the PNG is published to this repo's widget branch.
const graphUrl = process.env.DISCORD_GRAPH_URL
  || (GITHUB_REPOSITORY && `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/widget/discord-graph.png`);
if (!DISCORD_APP_ID || !DISCORD_USER_ID || !graphUrl) {
  console.log('::error::DISCORD_APP_ID, DISCORD_USER_ID and DISCORD_GRAPH_URL (or GITHUB_REPOSITORY) must be set.');
  process.exit(1);
}

const stats = JSON.parse(await readFile(new URL('../out/discord-widget.json', import.meta.url), 'utf8'));

// The ?v= cache-buster makes Discord's media proxy fetch the new PNG each day.
const payload = {
  username: process.env.DISCORD_USERNAME || 'jovci',
  data: {
    dynamic: [
      { type: 2, name: 'streak', value: stats.streak },
      { type: 1, name: 'month_distance', value: stats.month_distance },
      { type: 3, name: 'graph', value: { url: `${graphUrl}?v=${stats.date}` } },
    ],
  },
};

const res = await fetch(`https://discord.com/api/v9/applications/${DISCORD_APP_ID}/users/${DISCORD_USER_ID}/identities/0/profile`, {
  method: 'PATCH',
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.log(`::error::Discord widget update failed: ${res.status} ${await res.text()}`);
  process.exitCode = 1;
} else {
  console.log(`Discord widget updated: ${stats.streak}-day streak, ${stats.month_distance}.`);
}
