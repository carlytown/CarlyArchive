// CDs — MusicBrainz + Cover Art Archive (no key), with iTunes fallback for covers.
import { fetchJson, rateLimit } from '../lib/utils.mjs';

const MB = 'https://musicbrainz.org/ws/2';
const HEADERS = { 'User-Agent': 'CarlysArchive/0.1 (personal-site; contact via github)' };

async function itunesCover(title, artist) {
  if (!title) return null;
  const term = encodeURIComponent([artist, title].filter(Boolean).join(' '));
  const url = `https://itunes.apple.com/search?term=${term}&entity=album&limit=1`;
  await rateLimit('itunes.apple.com', 250);
  try {
    const data = await fetchJson(url);
    const hit = data?.results?.[0];
    if (!hit?.artworkUrl100) return null;
    // Upgrade resolution from 100x100 to 600x600.
    return hit.artworkUrl100.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/600x600bb.$2');
  } catch {
    return null;
  }
}

export async function enrichCd(item) {
  const out = {};
  let release;

  if (item.overrideId) {
    await rateLimit('musicbrainz.org', 1100);
    release = await fetchJson(`${MB}/release/${item.overrideId}?inc=artist-credits+labels+recordings+release-groups&fmt=json`, HEADERS);
  } else {
    const q = [
      item.title ? `release:"${item.title.replace(/"/g, '')}"` : '',
      item.artist ? `artist:"${item.artist.replace(/"/g, '')}"` : ''
    ].filter(Boolean).join(' AND ');
    if (q) {
      await rateLimit('musicbrainz.org', 1100);
      const search = await fetchJson(`${MB}/release/?query=${encodeURIComponent(q)}&limit=1&fmt=json`, HEADERS);
      release = search.releases?.[0];
      if (release) {
        await rateLimit('musicbrainz.org', 1100);
        release = await fetchJson(`${MB}/release/${release.id}?inc=artist-credits+labels+recordings+release-groups&fmt=json`, HEADERS);
      }
    }
  }

  // Build an ordered list of candidate cover URLs — the downloader will try
  // them in order and keep the first one that actually returns image bytes.
  const covers = [];

  if (release) {
    out.year = release.date ? Number(release.date.slice(0, 4)) : null;
    out.label = release['label-info']?.[0]?.label?.name || null;
    out.tracks = (release.media || []).flatMap(m => (m.tracks || []).map(t => t.title));
    if (!item.artist && release['artist-credit']?.[0]?.name) {
      out.artist = release['artist-credit'][0].name;
    }
    covers.push(`https://coverartarchive.org/release/${release.id}/front-500`);
    if (release['release-group']?.id) {
      covers.push(`https://coverartarchive.org/release-group/${release['release-group'].id}/front-500`);
    }
  }

  // iTunes is the most reliable for commercial albums — always include it.
  const itunes = await itunesCover(item.title, item.artist || out.artist);
  if (itunes) covers.push(itunes);

  if (covers.length) {
    out._coverUrl = covers[0];
    out._coverFallbackUrls = covers.slice(1);
  }

  return out;
}
