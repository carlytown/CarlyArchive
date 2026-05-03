// Video games — RAWG (free key required: process.env.RAWG_API_KEY)
// Falls back to Wikipedia for cover art when RAWG has no image.
import { fetchJson, rateLimit } from '../lib/utils.mjs';
import { wikipediaImage } from '../lib/wikipedia.mjs';

const KEY = () => process.env.RAWG_API_KEY;

const wikipediaGameImage = title => wikipediaImage(title, ['video game']);

export async function enrichGame(item) {
  let game = null;
  if (KEY()) {
    try {
      if (item.overrideId) {
        await rateLimit('rawg.io', 250);
        game = await fetchJson(`https://api.rawg.io/api/games/${item.overrideId}?key=${KEY()}`);
      } else if (item.title) {
        await rateLimit('rawg.io', 250);
        const search = await fetchJson(`https://api.rawg.io/api/games?key=${KEY()}&search=${encodeURIComponent(item.title)}&page_size=1`);
        const slug = search.results?.[0]?.slug;
        if (slug) {
          await rateLimit('rawg.io', 250);
          game = await fetchJson(`https://api.rawg.io/api/games/${slug}?key=${KEY()}`);
        }
      }
    } catch { /* fall through to Wikipedia for cover */ }
  }

  const out = {
    year: game?.released ? Number(game.released.slice(0, 4)) : null,
    developer: game?.developers?.[0]?.name || null,
    genre: (game?.genres || []).map(g => g.name),
    description: game?.description_raw ? game.description_raw.slice(0, 500) : null,
    _coverUrl: game?.background_image || null
  };

  // Wikipedia fallback for cover art when RAWG didn't have one.
  if (!out._coverUrl) {
    const wikiCover = await wikipediaGameImage(item.title);
    if (wikiCover) {
      out._coverUrl = wikiCover;
    }
  } else {
    // Keep Wikipedia as a secondary fallback in case RAWG's CDN URL fails to load.
    const wikiCover = await wikipediaGameImage(item.title);
    if (wikiCover && wikiCover !== out._coverUrl) {
      out._coverFallbackUrls = [wikiCover];
    }
  }

  return out;
}
