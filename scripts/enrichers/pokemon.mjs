// Pokémon cards — pokemontcg.io (optional key: process.env.POKEMON_TCG_API_KEY).
// Enriches a card by its pinned Card ID (e.g. "sv3pt5-25") with set, rarity,
// number, release year, art and a USD-only average price snapshot.
import { fetchJson, rateLimit } from '../lib/utils.mjs';

const KEY = () => process.env.POKEMON_TCG_API_KEY;

// USD price precedence: prefer the "normal" print, then the common foil
// variants. Cardmarket (EUR) is intentionally ignored — USD only.
const PRICE_VARIANTS = [
  'normal',
  'holofoil',
  'reverseHolofoil',
  '1stEditionHolofoil',
  '1stEditionNormal',
  'unlimitedHolofoil'
];

// Pull the best USD market price out of a tcgplayer.prices hash.
function usdMarketPrice(tcgplayer) {
  const prices = tcgplayer?.prices;
  if (!prices) return null;
  for (const v of PRICE_VARIANTS) {
    const market = prices[v]?.market;
    if (typeof market === 'number' && market > 0) return market;
  }
  // Fall back to whatever variant exists if none of the known ones matched.
  for (const variant of Object.values(prices)) {
    if (typeof variant?.market === 'number' && variant.market > 0) return variant.market;
  }
  return null;
}

// Map a raw pokemontcg.io card object to our enrichment fields.
export function mapCardToEnrichment(card) {
  const releaseDate = card?.set?.releaseDate || null; // "YYYY/MM/DD"
  const year = releaseDate ? Number(String(releaseDate).slice(0, 4)) : null;
  const out = {
    artist: card?.artist || null,
    set: card?.set?.name || null,
    series: card?.set?.series || null,
    number: card?.number || null,
    rarity: card?.rarity || null,
    year: Number.isFinite(year) ? year : null,
    priceAvg: usdMarketPrice(card?.tcgplayer),
    priceCurrency: 'USD',
    priceUpdated: card?.tcgplayer?.updatedAt || null,
    tcgUrl: card?.tcgplayer?.url || null,
    _coverUrl: card?.images?.small || card?.images?.large || null
  };
  // Keep the hi-res image as a fallback if the small one ever fails to load.
  if (card?.images?.large && card.images.large !== out._coverUrl) {
    out._coverFallbackUrls = [card.images.large];
  }
  return out;
}

export async function enrichPokemon(item) {
  const id = item.overrideId; // pinned Card ID from Notion ("Card ID" / "Override ID")
  if (!id) return {};

  await rateLimit('api.pokemontcg.io', 250);
  const headers = KEY() ? { 'X-Api-Key': KEY() } : {};
  const res = await fetchJson(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`, headers);
  const card = res?.data;
  if (!card) return {};
  return mapCardToEnrichment(card);
}
