// Video games — RAWG (free key required: process.env.RAWG_API_KEY)
import { fetchJson, rateLimit } from '../lib/utils.mjs';

const KEY = () => process.env.RAWG_API_KEY;

export async function enrichGame(item) {
  if (!KEY()) return {};
  let game;
  if (item.overrideId) {
    await rateLimit('rawg.io', 250);
    game = await fetchJson(`https://api.rawg.io/api/games/${item.overrideId}?key=${KEY()}`);
  } else {
    if (!item.title) return {};
    await rateLimit('rawg.io', 250);
    const search = await fetchJson(`https://api.rawg.io/api/games?key=${KEY()}&search=${encodeURIComponent(item.title)}&page_size=1`);
    const slug = search.results?.[0]?.slug;
    if (!slug) return {};
    await rateLimit('rawg.io', 250);
    game = await fetchJson(`https://api.rawg.io/api/games/${slug}?key=${KEY()}`);
  }
  return {
    year: game.released ? Number(game.released.slice(0, 4)) : null,
    developer: game.developers?.[0]?.name || null,
    genre: (game.genres || []).map(g => g.name),
    description: game.description_raw ? game.description_raw.slice(0, 500) : null,
    _coverUrl: game.background_image || null
  };
}
