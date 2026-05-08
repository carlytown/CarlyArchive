// Wikipedia REST API helper — no key needed. Uses opensearch to find the
// best-matching page, then pulls the lead image from the page summary.
import { fetchJson, rateLimit } from './utils.mjs';

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function wikipediaImage(query, hints = []) {
  if (!query) return null;
  const qNorm = normalize(query);
  const qTokens = new Set(qNorm.split(' ').filter(Boolean));
  // hints describe what kind of subject we want (e.g. "singer", "band").
  // We use them to validate the Wikipedia page description so we don't
  // pick the wrong topic (e.g. "Tennis" the sport vs the band).
  const hintTokens = hints.map(h => normalize(h)).filter(Boolean);
  // Try bare query first (most reliable for famous artists), then variants with hints.
  const queries = [query, ...hints.map(h => `${query} ${h}`)];
  // Track candidates so we can pick the best one if no perfect match is found.
  const candidates = [];
  for (const q of queries) {
    try {
      await rateLimit('en.wikipedia.org', 200);
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=5&search=${encodeURIComponent(q)}`;
      const result = await fetchJson(searchUrl);
      const titles = Array.isArray(result) ? result[1] || [] : [];
      for (const pageTitle of titles) {
        // Verify the page title contains all of the query's tokens.
        const titleTokens = new Set(normalize(pageTitle).split(' ').filter(Boolean));
        const matches = [...qTokens].every(t => titleTokens.has(t));
        if (!matches) continue;
        try {
          await rateLimit('en.wikipedia.org', 200);
          const slug = encodeURIComponent(pageTitle.replace(/\s+/g, '_'));
          const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
          const url = data?.originalimage?.source || data?.thumbnail?.source;
          if (!url) continue;
          // Logo / wordmark filter is a soft penalty.
          const isLogo = /logo|wordmark/i.test(url) || /\.svg(\.png)?$/i.test(url);
          const desc = normalize(`${data?.description || ''} ${data?.extract || ''}`);
          // If hints provided, require at least one to appear in the description.
          if (hintTokens.length) {
            const hit = hintTokens.some(h => desc.includes(h));
            if (hit && !isLogo) return url;
            candidates.push({ url, score: hit ? 1 : (isLogo ? 0 : 0.5) });
          } else {
            return url;
          }
        } catch { /* try next title */ }
      }
    } catch { /* try next query */ }
  }
  // No description-match found — return best candidate (highest score).
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || null;
}
