// Characters — multi-source cascade for portrait images.
// Priority: explicit imageUrl override → Jikan (anime/manga) → Wikipedia → null.
// No API keys required for any source.
import { fetchJson, rateLimit } from '../lib/utils.mjs';
import { wikipediaImage } from '../lib/wikipedia.mjs';

// Normalize names for fuzzy comparison: lowercase, strip diacritics + non-letters,
// and recognize the "Family Given" / "Given Family" swap common in Japanese names.
function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function nameTokens(s) { return new Set(normName(s).split(' ').filter(Boolean)); }
function tokensMatch(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  // Every token of the shorter set must appear in the larger set.
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

// Generate Hepburn romanization variants for common English-friendly spellings
// (e.g. "Kyo Sohma" → "Kyou Souma"). Jikan stores names in strict Hepburn so
// the user-facing English spelling won't match unless we expand it.
function romajiVariants(name) {
  const variants = new Set([name]);
  const subs = [
    [/\boh\b/gi, 'ou'], [/oh(?=[a-z])/gi, 'ou'],
    [/\buh\b/gi, 'u'],
    [/sh([aeiou])/gi, 'sh$1'], // no-op placeholder
    [/yo\b/gi, 'you'], // kyo → kyou
    [/o\b/gi, 'ou'],   // sho → shou
    [/ou/gi, 'o'],     // reverse: souma → soma (rare)
  ];
  // Apply each substitution independently to capture both directions.
  for (const [re, rep] of subs) {
    const v = name.replace(re, rep);
    if (v !== name) variants.add(v);
  }
  // Common name-specific swaps.
  const pairs = [
    ['sohma', 'souma'], ['souma', 'sohma'],
    ['kyo', 'kyou'], ['kyou', 'kyo'],
    ['ryo', 'ryou'], ['ryou', 'ryo'],
    ['yuki', 'yuuki'], ['yuuki', 'yuki'],
    ['sho', 'shou'], ['shou', 'sho'],
  ];
  for (const v of [...variants]) {
    for (const [a, b] of pairs) {
      const re = new RegExp(`\\b${a}\\b`, 'gi');
      if (re.test(v)) variants.add(v.replace(re, b));
    }
  }
  return [...variants];
}

async function jikanCharacterImage(name, source) {
  if (!name) return null;
  try {
    // Try each romanization variant until we get candidates.
    let candidates = [];
    for (const variant of romajiVariants(name)) {
      await rateLimit('jikan.moe', 1100);
      const r = await fetchJson(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(variant)}&limit=10`);
      const got = r.data || [];
      if (got.length) {
        candidates = candidates.concat(got);
        // If any candidate's name tokens match this variant, we're good.
        if (got.some(c => tokensMatch(c.name, variant))) break;
      }
    }
    // Dedupe by mal_id.
    const seen = new Set();
    candidates = candidates.filter(c => !seen.has(c.mal_id) && seen.add(c.mal_id));
    if (!candidates.length) return null;

    // Filter to candidates whose name tokens match any romanization variant.
    const variants = romajiVariants(name);
    const nameMatches = candidates.filter(c => variants.some(v => tokensMatch(c.name, v)));
    const pool = nameMatches.length ? nameMatches : candidates;

    // If we have a source hint, prefer candidates whose anime list includes it.
    if (source) {
      const srcNorm = normName(source);
      // The basic search doesn't include anime list — fetch /full for top
      // candidates until we find one matching the source.
      for (const c of pool.slice(0, 5)) {
        try {
          await rateLimit('jikan.moe', 1100);
          const full = await fetchJson(`https://api.jikan.moe/v4/characters/${c.mal_id}/full`);
          const anime = full.data?.anime || [];
          const manga = full.data?.manga || [];
          const hit = [...anime, ...manga].some(a => {
            const t = normName(a.anime?.title || a.manga?.title);
            return t.includes(srcNorm) || srcNorm.includes(t);
          });
          if (hit) return c.images?.jpg?.image_url || c.images?.webp?.image_url || null;
        } catch { /* try next */ }
      }
    }

    // No source hint or no source-match found — fall back to first name-matching candidate.
    const pick = pool[0];
    return pick?.images?.jpg?.image_url || pick?.images?.webp?.image_url || null;
  } catch {
    return null;
  }
}

export async function enrichCharacter(item) {
  // Manual override always wins.
  if (item.imageUrl) return { _coverUrl: item.imageUrl };

  const name = item.title || item.name;
  const source = item.source;
  const medium = (item.medium || '').toLowerCase();

  // Override MAL character ID — direct lookup, skips search entirely.
  const malId = String(item.overrideId || '').trim().match(/^\d+$/)?.[0];
  if (malId) {
    try {
      await rateLimit('jikan.moe', 1100);
      const r = await fetchJson(`https://api.jikan.moe/v4/characters/${malId}/full`);
      const img = r.data?.images?.jpg?.image_url || r.data?.images?.webp?.image_url;
      if (img) return { _coverUrl: img };
    } catch { /* fall through */ }
  }

  // 1. Jikan for anime/manga characters (best art).
  if (['anime', 'manga'].includes(medium)) {
    const img = await jikanCharacterImage(name, source);
    if (img) return { _coverUrl: img };
  }

  // 2. Wikipedia — works for many famous characters across all media.
  // Try "<name> (<medium>)" then "<name> <source>" then plain name.
  const hints = [];
  if (medium) hints.push(`(${medium})`);
  if (source) hints.push(source);
  hints.push('character');
  const wiki = await wikipediaImage(name, hints);
  if (wiki) return { _coverUrl: wiki };

  // 3. Last resort for non-anime: still try Jikan in case it's a character that
  // got famous from anime adaptations (e.g. Sailor Moon).
  if (!['anime', 'manga'].includes(medium)) {
    const img = await jikanCharacterImage(name, source);
    if (img) return { _coverUrl: img };
  }

  return {};
}
