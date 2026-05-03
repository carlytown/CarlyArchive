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
  ROOT, ensureDir, downloadFile, hash, fetchJson, rateLimit
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

async function localiseImage(url, kind, key) {
  if (!url) return null;
  const ext = (url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const local = `assets/lastfm/${kind}/${hash(key)}.${ext}`;
  const dest = path.join(ROOT, local);
  try {
    await downloadFile(url, dest);
    return local;
  } catch (e) {
    console.warn(`  ! lastfm cover failed (${kind}/${key}): ${e.message}`);
    return null;
  }
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

async function fetchTopArtists() {
  const data = await lfm('user.gettopartists', { period: 'overall', limit: 20 });
  const artists = data?.topartists?.artist || [];
  const out = [];
  for (const a of artists) {
    const img = bestImage(a.image); // last.fm artist images are usually placeholders nowadays
    out.push({
      name: a.name,
      playcount: Number(a.playcount),
      url: a.url,
      image: img ? await localiseImage(img, 'artists', a.name) : null
    });
  }
  return out;
}

async function fetchTopAlbums() {
  const data = await lfm('user.gettopalbums', { period: 'overall', limit: 24 });
  const albums = data?.topalbums?.album || [];
  const out = [];
  for (const a of albums) {
    const img = bestImage(a.image);
    out.push({
      name: a.name,
      artist: a.artist?.name || '',
      playcount: Number(a.playcount),
      url: a.url,
      image: img ? await localiseImage(img, 'albums', `${a.artist?.name}__${a.name}`) : null
    });
  }
  return out;
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
  await ensureDir(path.join(ROOT, 'assets', 'lastfm', 'albums'));
  await ensureDir(path.join(ROOT, 'assets', 'lastfm', 'artists'));

  const [recent, topArtists, topAlbums] = await Promise.all([
    fetchRecent(),
    fetchTopArtists(),
    fetchTopAlbums()
  ]);

  const out = {
    user: USER,
    fetchedAt: new Date().toISOString(),
    nowPlaying: recent.find(t => t.nowPlaying) || null,
    recent: recent.filter(t => !t.nowPlaying).slice(0, 10),
    topArtists,
    topAlbums
  };

  await ensureDir(path.join(ROOT, 'data'));
  await fs.writeFile(path.join(ROOT, 'data', 'lastfm.json'), JSON.stringify(out, null, 2));
  console.log(`  ✓ wrote data/lastfm.json (${recent.length} recent, ${topArtists.length} artists, ${topAlbums.length} albums)`);

  // Public config so the browser can ping last.fm directly for live now-playing.
  // The read-only API key is safe to expose; it's the same scope a last.fm
  // embed widget uses.
  await fs.writeFile(
    path.join(ROOT, 'data', 'lastfm-config.json'),
    JSON.stringify({ user: USER, apiKey: API_KEY }, null, 2)
  );
  console.log(`  ✓ wrote data/lastfm-config.json`);

  await mergePlaycountsIntoCds(topAlbums);
}

main().catch(err => {
  console.error('✖ lastfm fetch failed:', err.message);
  // Don't fail the build — Last.fm hiccups shouldn't block deploys.
  process.exit(0);
});
