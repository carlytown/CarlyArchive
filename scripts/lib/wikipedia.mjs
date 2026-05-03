// Wikipedia REST API helper — no key needed. Uses opensearch to find the
// best-matching page, then pulls the lead image from the page summary.
import { fetchJson, rateLimit } from './utils.mjs';

export async function wikipediaImage(query, hints = []) {
  if (!query) return null;
  // Try query variants (e.g. "Hatsune Miku", "Hatsune Miku band").
  const queries = [...hints.map(h => `${query} ${h}`), query];
  for (const q of queries) {
    try {
      await rateLimit('en.wikipedia.org', 200);
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=3&search=${encodeURIComponent(q)}`;
      const result = await fetchJson(searchUrl);
      const titles = Array.isArray(result) ? result[1] || [] : [];
      for (const pageTitle of titles) {
        try {
          await rateLimit('en.wikipedia.org', 200);
          const slug = encodeURIComponent(pageTitle.replace(/\s+/g, '_'));
          const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
          const url = data?.originalimage?.source || data?.thumbnail?.source;
          if (url) return url;
        } catch { /* try next title */ }
      }
    } catch { /* try next query */ }
  }
  return null;
}
