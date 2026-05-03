// Concerts — Setlist.fm (free key required: process.env.SETLISTFM_API_KEY)
// Artist photo is pulled from Wikipedia (no key required).
import { fetchJson, rateLimit } from '../lib/utils.mjs';
import { wikipediaImage } from '../lib/wikipedia.mjs';

const KEY = () => process.env.SETLISTFM_API_KEY;

export async function enrichConcert(item) {
  const out = {};

  // Always try Wikipedia for the artist's photo (works for both upcoming + past).
  if (item.artist) {
    const img = await wikipediaImage(item.artist, ['band', 'singer', 'musician']);
    if (img) out.artistImage = img;
  }

  if (!KEY() || !item.artist) return out;
  // Setlist.fm only has past shows. Skip enrichment for upcoming concerts so
  // we don't waste API calls (and so future-dated rows stay clean for the
  // upcoming section on the page).
  if (item.date) {
    const showDate = new Date(item.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!isNaN(showDate) && showDate > today) return out;
  }
  const headers = {
    'x-api-key': KEY(),
    'Accept': 'application/json'
  };
  let setlist;
  if (item.overrideId) {
    await rateLimit('setlist.fm', 600);
    setlist = await fetchJson(`https://api.setlist.fm/rest/1.0/setlist/${item.overrideId}`, headers);
  } else {
    const params = new URLSearchParams({ artistName: item.artist });
    if (item.date) {
      // Setlist.fm wants dd-MM-yyyy
      const [y, m, d] = item.date.split('-');
      if (y && m && d) params.set('date', `${d}-${m}-${y}`);
    }
    if (item.city) params.set('cityName', item.city);
    await rateLimit('setlist.fm', 600);
    const search = await fetchJson(`https://api.setlist.fm/rest/1.0/search/setlists?${params}`, headers);
    setlist = search.setlist?.[0];
  }
  if (!setlist) return out;
  const songs = (setlist.sets?.set || []).flatMap(s => (s.song || []).map(x => x.name)).filter(Boolean);
  return {
    ...out,
    tour: setlist.tour?.name || null,
    venue: setlist.venue?.name || item.venue,
    city: setlist.venue?.city?.name || item.city,
    setlist: songs
  };
}
