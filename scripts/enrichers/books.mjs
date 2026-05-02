// Books — Open Library (no API key required)
// Search:  https://openlibrary.org/search.json?title=...&author=...
// By ISBN: https://openlibrary.org/api/books?bibkeys=ISBN:0140328726&format=json&jscmd=data
// Cover:   https://covers.openlibrary.org/b/id/<cover_id>-L.jpg

import { fetchJson, rateLimit } from '../lib/utils.mjs';

export async function enrichBook(item) {
  const out = {};
  let work;

  if (item.overrideId) {
    // overrideId may be ISBN or OL key
    const id = item.overrideId.trim();
    if (/^\d{9,13}X?$/i.test(id.replace(/-/g, ''))) {
      await rateLimit('openlibrary.org', 300);
      const data = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(id)}&format=json&jscmd=data`);
      work = data[`ISBN:${id}`];
    } else {
      await rateLimit('openlibrary.org', 300);
      work = await fetchJson(`https://openlibrary.org/works/${encodeURIComponent(id)}.json`);
    }
  } else {
    await rateLimit('openlibrary.org', 300);
    const params = new URLSearchParams({
      title: item.title || '',
      ...(item.author ? { author: item.author } : {}),
      limit: '1'
    });
    const search = await fetchJson(`https://openlibrary.org/search.json?${params}`);
    work = search.docs?.[0];
  }

  if (!work) return out;

  out.year = work.first_publish_year || work.publish_date || null;
  out.publisher = (work.publishers && work.publishers[0]?.name) || (Array.isArray(work.publisher) ? work.publisher[0] : null);
  out.pageCount = work.number_of_pages_median || work.number_of_pages || null;
  out.genre = work.subject ? work.subject.slice(0, 5) : (work.subjects ? work.subjects.slice(0, 5).map(s => s.name || s) : null);

  const coverId = work.cover_i || work.cover_id;
  if (coverId) {
    out._coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  } else if (work.cover?.large) {
    out._coverUrl = work.cover.large;
  }

  if (work.description) {
    out.description = typeof work.description === 'string' ? work.description : work.description.value;
  }

  return out;
}
