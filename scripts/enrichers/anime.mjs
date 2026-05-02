// Anime — Jikan (MyAnimeList unofficial API, no key)
import { fetchJson, rateLimit } from '../lib/utils.mjs';

export async function enrichAnime(item) {
  const out = {};
  let anime;
  if (item.overrideId) {
    await rateLimit('jikan.moe', 1100);
    const r = await fetchJson(`https://api.jikan.moe/v4/anime/${item.overrideId}`);
    anime = r.data;
  } else {
    if (!item.title) return out;
    await rateLimit('jikan.moe', 1100);
    const r = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(item.title)}&limit=1`);
    anime = r.data?.[0];
  }
  if (!anime) return out;

  out.year = anime.year || (anime.aired?.from ? Number(anime.aired.from.slice(0, 4)) : null);
  out.studio = anime.studios?.[0]?.name || null;
  out.episodes = anime.episodes || null;
  out.genre = (anime.genres || []).map(g => g.name);
  out.description = anime.synopsis || null;
  out._coverUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null;
  return out;
}
