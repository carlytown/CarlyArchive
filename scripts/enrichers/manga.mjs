// Manga — Jikan (MyAnimeList unofficial API, no key)
import { fetchJson, rateLimit } from '../lib/utils.mjs';

export async function enrichManga(item) {
  const out = {};
  let manga;
  if (item.overrideId) {
    await rateLimit('jikan.moe', 1100);
    const r = await fetchJson(`https://api.jikan.moe/v4/manga/${item.overrideId}`);
    manga = r.data;
  } else {
    if (!item.title) return out;
    await rateLimit('jikan.moe', 1100);
    const r = await fetchJson(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(item.title)}&limit=1`);
    manga = r.data?.[0];
  }
  if (!manga) return out;

  out.year = manga.published?.from ? Number(manga.published.from.slice(0, 4)) : null;
  out.author = manga.authors?.[0]?.name || null;
  out.totalVolumes = manga.volumes || null;
  out.totalChapters = manga.chapters || null;
  out.publishStatus = manga.status || null; // "Publishing" / "Finished" / etc.
  out.genre = (manga.genres || []).map(g => g.name);
  out.serialization = manga.serializations?.[0]?.name || null;
  out.description = manga.synopsis || null;
  out._coverUrl = manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url || null;
  return out;
}
