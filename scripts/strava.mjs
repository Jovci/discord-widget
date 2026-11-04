// Fetches runs from Strava and writes the Discord widget's graph (SVG) and stats (JSON) to out/.
// Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
// Optional: STRAVA_UNITS (mi|km, default mi), STRAVA_INCLUDE_PRIVATE (true|false, default true)
import { mkdir, writeFile } from 'node:fs/promises';

const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const UNITS = process.env.STRAVA_UNITS === 'km' ? 'km' : 'mi';
const PER_UNIT = UNITS === 'km' ? 1000 : 1609.344;
const INCLUDE_PRIVATE = process.env.STRAVA_INCLUDE_PRIVATE !== 'false';
const WEEKS = 16;
const OUT_DIR = new URL('../out/', import.meta.url);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLORS = { text: '#949ba4', today: '#f2f3f5', ran: '#34c759', missed: '#3f3c3c' };

const dateKey = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

async function accessToken() {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.refresh_token && body.refresh_token !== process.env.STRAVA_REFRESH_TOKEN) {
    console.warn('::warning::Strava rotated the refresh token. Update the STRAVA_REFRESH_TOKEN secret.');
  }
  return body.access_token;
}

async function activities(token, after) {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Activity fetch failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 200) return all;
  }
}

// Meters per local day. start_date_local is local wall-clock time labelled Z, so its date part is the local day.
function totals(list) {
  const out = {};
  for (const a of list) {
    if (!RUN_TYPES.includes(a.sport_type || a.type)) continue;
    if (a.private && !INCLUDE_PRIVATE) continue;
    const key = a.start_date_local.slice(0, 10);
    out[key] = (out[key] || 0) + a.distance;
  }
  return out;
}

// Columns are weeks (Sun-Sat), ending with the current week; future days are null.
function grid(today) {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - end.getUTCDay() - (WEEKS - 1) * 7);
  const weeks = [];
  for (let w = 0; w < WEEKS; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const x = new Date(start);
      x.setUTCDate(x.getUTCDate() + w * 7 + d);
      days.push(x > end ? null : x);
    }
    weeks.push(days);
  }
  return { start, weeks };
}

const fmt = n => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

// Consecutive run days ending today, or yesterday if today has no run yet.
function streak(byDay, today) {
  const d = new Date(today);
  if (!byDay[dateKey(d)]) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (byDay[dateKey(d)]) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}

function monthTotal(byDay, today) {
  const prefix = dateKey(today).slice(0, 7);
  let m = 0;
  for (const [key, meters] of Object.entries(byDay)) if (key.startsWith(prefix)) m += meters;
  return m / PER_UNIT;
}

// Dark dot grid with month labels and a transparent background. The workflow rasterizes it to PNG.
function render({ weeks }, byDay, today) {
  const colStep = 25, rowStep = 20, r = 5.5;
  const top = 18;
  const width = (WEEKS - 1) * colStep + 2 * r;
  const height = top + 6 * rowStep + 2 * r;
  const todayKey = dateKey(today);
  const parts = [];
  let lastMonth = -1;

  weeks.forEach((col, w) => {
    const first = col[0];
    // Label the first column and each column holding the 1st; the last label is right-aligned to stay inside.
    if (first.getUTCMonth() !== lastMonth && (w === 0 || first.getUTCDate() <= 7)) {
      lastMonth = first.getUTCMonth();
      const end = w === WEEKS - 1;
      parts.push(`<text x="${end ? width : w * colStep}" y="10"${end ? ' text-anchor="end"' : ''}>${MONTHS[lastMonth]}</text>`);
    }
    col.forEach((day, d) => {
      if (!day) return;
      const key = dateKey(day);
      const cx = w * colStep + r, cy = top + d * rowStep + r;
      const shape = byDay[key]
        ? `r="${r}" fill="${COLORS.ran}"`
        : `r="${r - 0.75}" fill="none" stroke="${key === todayKey ? COLORS.today : COLORS.missed}" stroke-width="1.5"`;
      parts.push(`<circle cx="${cx}" cy="${cy}" ${shape}/>`);
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="10" fill="${COLORS.text}">
${parts.join('\n')}
</svg>
`;
}

const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
const layout = grid(today);
const after = Math.floor(layout.start.getTime() / 1000) - 86400;
const byDay = totals(await activities(await accessToken(), after));

// Field names must match the Data Field keys in the Discord widget editor.
const stats = {
  date: dateKey(today),
  streak: streak(byDay, today),
  month_distance: `${fmt(monthTotal(byDay, today))} ${UNITS} in ${MONTHS[today.getUTCMonth()]}`,
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('discord-graph.svg', OUT_DIR), render(layout, byDay, today));
await writeFile(new URL('discord-widget.json', OUT_DIR), JSON.stringify(stats, null, 2) + '\n');
console.log(`Rendered ${Object.keys(byDay).length} run days: ${stats.streak}-day streak, ${stats.month_distance}.`);
