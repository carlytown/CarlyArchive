// Concerts — Setlist.fm (free key required: process.env.SETLISTFM_API_KEY)
import { fetchJson, rateLimit } from '../lib/utils.mjs';

const KEY = () => process.env.SETLISTFM_API_KEY;

export async function enrichConcert(item) {
  if (!KEY() || !item.artist) return {};
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
  if (!setlist) return {};
  const songs = (setlist.sets?.set || []).flatMap(s => (s.song || []).map(x => x.name)).filter(Boolean);
  return {
    tour: setlist.tour?.name || null,
    venue: setlist.venue?.name || item.venue,
    city: setlist.venue?.city?.name || item.city,
    setlist: songs
  };
}
