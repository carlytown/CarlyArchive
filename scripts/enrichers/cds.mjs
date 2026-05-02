// CDs — MusicBrainz + Cover Art Archive (no key)
import { fetchJson, rateLimit } from '../lib/utils.mjs';

const MB = 'https://musicbrainz.org/ws/2';
const HEADERS = { 'User-Agent': 'CarlysArchive/0.1 (personal-site; contact via github)' };

export async function enrichCd(item) {
  const out = {};
  let release;

  if (item.overrideId) {
    await rateLimit('musicbrainz.org', 1100);
    release = await fetchJson(`${MB}/release/${item.overrideId}?inc=artist-credits+labels+recordings&fmt=json`, HEADERS);
  } else {
    const q = [
      item.title ? `release:"${item.title.replace(/"/g, '')}"` : '',
      item.artist ? `artist:"${item.artist.replace(/"/g, '')}"` : ''
    ].filter(Boolean).join(' AND ');
    if (!q) return out;
    await rateLimit('musicbrainz.org', 1100);
    const search = await fetchJson(`${MB}/release/?query=${encodeURIComponent(q)}&limit=1&fmt=json`, HEADERS);
    release = search.releases?.[0];
    if (release) {
      await rateLimit('musicbrainz.org', 1100);
      release = await fetchJson(`${MB}/release/${release.id}?inc=artist-credits+labels+recordings&fmt=json`, HEADERS);
    }
  }
  if (!release) return out;

  out.year = release.date ? Number(release.date.slice(0, 4)) : null;
  out.label = release['label-info']?.[0]?.label?.name || null;
  out.tracks = (release.media || []).flatMap(m => (m.tracks || []).map(t => t.title));
  if (!item.artist && release['artist-credit']?.[0]?.name) {
    out.artist = release['artist-credit'][0].name;
  }
  out._coverUrl = `https://coverartarchive.org/release/${release.id}/front-500`;
  return out;
}
