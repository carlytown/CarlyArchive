// Fetch Last.fm scrobble data for the home "now playing" widget,
// the dedicated music page (top artists / top albums / recent), and
// per-album play counts that get merged into data/cds.json.
//
// Public API — only needs a key. Free at https://www.last.fm/api/account/create
//
// Run as part of `npm run build` (and the watch loop).

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, ensureDir, fetchJson, rateLimit
} from './lib/utils.mjs';

const API_KEY = process.env.LASTFM_API_KEY;
const USER    = process.env.LASTFM_USER || 'carlytown';

if (!API_KEY) {
  console.log('· lastfm: no LASTFM_API_KEY set — skipping');
  process.exit(0);
}

const BASE = 'https://ws.audioscrobbler.com/2.0/';

async function lfm(method, extra = {}) {
  const params = new URLSearchParams({
    method, user: USER, api_key: API_KEY, format: 'json', ...extra
  });
  await rateLimit('ws.audioscrobbler.com', 250);
  return fetchJson(`${BASE}?${params}`);
}

function bestImage(images) {
  if (!Array.isArray(images)) return null;
  const order = ['mega', 'extralarge', 'large', 'medium', 'small'];
  for (const size of order) {
    const m = images.find(i => i.size === size && i['#text']);
    if (m) return m['#text'];
  }
  return null;
}

function normaliseTrack(t) {
  return {
    name:    t.name,
    artist:  t.artist?.['#text'] || t.artist?.name || '',
    album:   t.album?.['#text'] || '',
    url:     t.url,
    image:   bestImage(t.image),
    nowPlaying: t['@attr']?.nowplaying === 'true',
    date:    t.date?.['#text'] || null,
    uts:     t.date?.uts ? Number(t.date.uts) : null
  };
}

async function fetchRecent() {
  const data = await lfm('user.getrecenttracks', { limit: 20 });
  const tracks = (data?.recenttracks?.track || []).map(normaliseTrack);
  return tracks;
}

async function fetchTopArtists(period = 'overall') {
  const data = await lfm('user.gettopartists', { period, limit: 20 });
  const artists = data?.topartists?.artist || [];
  // Last.fm deprecated artist images in 2019 — they all return the same grey
  // star placeholder. Skip the download entirely; the UI uses text only.
  return artists.map(a => ({
    name: a.name,
    playcount: Number(a.playcount),
    url: a.url,
    image: null
  }));
}

async function fetchTopAlbums(period = 'overall') {
  const data = await lfm('user.gettopalbums', { period, limit: 24 });
  const albums = data?.topalbums?.album || [];
  // Hotlink directly from Last.fm's CDN — stable, fast, and avoids repo bloat.
  return albums.map(a => ({
    name: a.name,
    artist: a.artist?.name || '',
    playcount: Number(a.playcount),
    url: a.url,
    image: bestImage(a.image)
  }));
}

async function mergePlaycountsIntoCds(topAlbums) {
  // Best-effort: match by (artist, album title) case-insensitively, fall back
  // to title-only. Adds `playcount` to matching cds entries.
  const cdsPath = path.join(ROOT, 'data', 'cds.json');
  let cds;
  try { cds = JSON.parse(await fs.readFile(cdsPath, 'utf8')); }
  catch { return; }

  // Pull a wider window of albums for matching (overall top 200) so older CDs match.
  const wide = await lfm('user.gettopalbums', { period: 'overall', limit: 200 });
  const lookup = new Map();
  for (const a of wide?.topalbums?.album || []) {
    const artist = (a.artist?.name || '').toLowerCase();
    const name = (a.name || '').toLowerCase();
    lookup.set(`${artist}::${name}`, Number(a.playcount));
    if (!lookup.has(name)) lookup.set(name, Number(a.playcount));
  }

  let matched = 0;
  for (const cd of cds) {
    const a = (cd.artist || '').toLowerCase();
    const t = (cd.title || '').toLowerCase();
    const pc = lookup.get(`${a}::${t}`) ?? lookup.get(t);
    if (pc) { cd.playcount = pc; matched++; }
  }
  await fs.writeFile(cdsPath, JSON.stringify(cds, null, 2));
  console.log(`  ✓ merged play counts into ${matched}/${cds.length} cds`);
}

async function main() {
  console.log(`→ lastfm: fetching for ${USER}…`);

  const PERIODS = [
    { key: '7day',     label: 'last week' },
    { key: '1month',   label: 'last month' },
    { key: '3month',   label: 'last 3 months' },
    { key: '6month',   label: 'last 6 months' },
    { key: '12month',  label: 'last year' },
    { key: 'overall',  label: 'all time' }
  ];

  const recent = await fetchRecent();

  // Sequential to be polite to the API.
  const byPeriod = {};
  for (const p of PERIODS) {
    const [topArtists, topAlbums] = [
      await fetchTopArtists(p.key),
      await fetchTopAlbums(p.key)
    ];
    byPeriod[p.key] = { topArtists, topAlbums };
    console.log(`  ✓ ${p.key}: ${topArtists.length} artists, ${topAlbums.length} albums`);
  }

  const overall = byPeriod.overall;

  const out = {
    user: USER,
    fetchedAt: new Date().toISOString(),
    nowPlaying: recent.find(t => t.nowPlaying) || null,
    recent: recent.filter(t => !t.nowPlaying).slice(0, 10),
    periods: PERIODS,
    byPeriod,
    // legacy keys (older clients) — same as overall
    topArtists: overall.topArtists,
    topAlbums:  overall.topAlbums
  };

  await ensureDir(path.join(ROOT, 'data'));
  await fs.writeFile(path.join(ROOT, 'data', 'lastfm.json'), JSON.stringify(out, null, 2));
  console.log(`  ✓ wrote data/lastfm.json (${recent.length} recent, ${PERIODS.length} periods)`);

  // Public config so the browser can ping last.fm directly for live now-playing.
  // The read-only API key is safe to expose; it's the same scope a last.fm
  // embed widget uses.
  await fs.writeFile(
    path.join(ROOT, 'data', 'lastfm-config.json'),
    JSON.stringify({ user: USER, apiKey: API_KEY }, null, 2)
  );
  console.log(`  ✓ wrote data/lastfm-config.json`);

  await mergePlaycountsIntoCds(overall.topAlbums);
}

main().catch(err => {
  console.error('✖ lastfm fetch failed:', err.message);
  // Don't fail the build — Last.fm hiccups shouldn't block deploys.
  process.exit(0);
});
