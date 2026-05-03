// Main build script.
// 1. Reads Notion databases listed in scripts/databases.json
// 2. Normalizes rows
// 3. Enriches via per-category APIs (cached in scripts/.cache/)
// 4. Downloads cover images locally
// 5. Writes data/<category>.json, data/all.json, data/stats.json

import 'dotenv/config';
import { Client } from '@notionhq/client';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ROOT, DATA_DIR,
  ensureDir, hash, readCache, writeCache,
  readProp, pageCover, pick
} from './lib/utils.mjs';

import { enrichBook } from './enrichers/books.mjs';
import { enrichManga } from './enrichers/manga.mjs';
import { enrichCd } from './enrichers/cds.mjs';
import { enrichAnime } from './enrichers/anime.mjs';
import { enrichMovie, enrichTv } from './enrichers/tmdb.mjs';
import { enrichGame } from './enrichers/games.mjs';
import { enrichConcert } from './enrichers/concerts.mjs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error('✖ NOTION_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const databases = JSON.parse(
  await fs.readFile(path.join(ROOT, 'scripts', 'databases.json'), 'utf8')
);

const notion = new Client({ auth: NOTION_TOKEN });

// Map: category -> { mapper, enricher (optional) }
const CATEGORIES = {
  manga:    { mapper: mapManga,   enricher: enrichManga },
  books:    { mapper: mapBook,    enricher: enrichBook },
  cds:      { mapper: mapCd,      enricher: enrichCd },
  concerts: { mapper: mapConcert, enricher: enrichConcert },
  anime:    { mapper: mapAnime,   enricher: enrichAnime },
  tv:       { mapper: mapTv,      enricher: enrichTv },
  movies:   { mapper: mapMovie,   enricher: enrichMovie },
  games:    { mapper: mapGame,    enricher: enrichGame },
  travel:   { mapper: mapTravel,  enricher: null }
};

async function queryAll(databaseId) {
  const all = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100
    });
    all.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return all;
}

// ---------- Mappers (Notion page -> flat object) ----------

function baseFields(page) {
  return {
    id: page.id,
    title: readProp(page, 'Title') || readProp(page, 'Name') || 'Untitled',
    rating: readProp(page, 'Rating'),
    review: readProp(page, 'Notes') || readProp(page, 'Review'),
    tags: readProp(page, 'Tags') || [],
    status: readProp(page, 'Status'),
    dateAdded: readProp(page, 'Date added') || page.created_time?.slice(0, 10),
    dateFinished: readProp(page, 'Date finished') || readProp(page, 'Date acquired'),
    overrideId: cleanOverrideId(readProp(page, 'Override ID') || readProp(page, 'OverrideID')),
    notionCover: pageCover(page)
  };
}

// Override IDs may be pasted as full URLs or with whitespace — extract the
// canonical ID for the relevant API:
//   - MusicBrainz: 36-char UUID (release MBID)
//   - MAL / others: numeric ID
function cleanOverrideId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // MusicBrainz / generic UUID anywhere in the string.
  const uuid = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0].toLowerCase();
  // URL with a numeric ID (MAL-style /anime/38680/Title).
  if (/^https?:\/\//i.test(s)) {
    const parts = s.split(/[?#]/)[0].split('/').filter(Boolean);
    const num = parts.find(p => /^\d+$/.test(p));
    if (num) return num;
    return parts[parts.length - 1] || null;
  }
  return s;
}

function mapBook(page) {
  return { ...baseFields(page), author: readProp(page, 'Author') };
}
function mapManga(page) {
  // Volumes owned is a multi-select of volume numbers ("1","2","3",...).
  const ownedRaw = readProp(page, 'Volumes owned') || [];
  const volumesOwned = (Array.isArray(ownedRaw) ? ownedRaw : [])
    .map(v => Number(String(v).trim()))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  return {
    ...baseFields(page),
    author: readProp(page, 'Author'),
    volumesOwned,
    volumesOwnedCount: volumesOwned.length
  };
}
function mapCd(page) {
  return { ...baseFields(page), artist: readProp(page, 'Artist') };
}
function mapConcert(page) {
  return {
    ...baseFields(page),
    artist: readProp(page, 'Artist'),
    date: readProp(page, 'Date') || readProp(page, 'Date finished'),
    venue: readProp(page, 'Venue'),
    city: readProp(page, 'City')
  };
}
function mapAnime(page) {
  return {
    ...baseFields(page),
    episodeProgress: readProp(page, 'Episode progress')
  };
}
function mapTv(page) {
  return { ...baseFields(page), year: readProp(page, 'Year') };
}
function mapMovie(page) {
  return { ...baseFields(page), year: readProp(page, 'Year') };
}
function mapGame(page) {
  return { ...baseFields(page), platform: readProp(page, 'Platform') };
}
function mapTravel(page) {
  return {
    ...baseFields(page),
    place: readProp(page, 'Place') || readProp(page, 'Title'),
    country: readProp(page, 'Country'),
    date: readProp(page, 'Date') || readProp(page, 'Dates')
  };
}

// ---------- Pipeline ----------

async function processCategory(category, dbId) {
  if (!dbId) {
    console.log(`· ${category}: no database id, skipping`);
    return [];
  }
  const cfg = CATEGORIES[category];
  if (!cfg) {
    console.warn(`! unknown category "${category}", skipping`);
    return [];
  }

  console.log(`\n→ ${category}: querying Notion…`);
  let pages;
  try {
    pages = await queryAll(dbId);
  } catch (e) {
    console.error(`  ✖ failed to query Notion for ${category}: ${e.message}`);
    return [];
  }
  console.log(`  ${pages.length} row(s) found`);

  const items = [];
  for (const page of pages) {
    const base = cfg.mapper(page);
    let enriched = {};

    if (cfg.enricher) {
      const cacheKey = base.overrideId
        ? `id-${base.overrideId}`
        : `q-${hash([base.title, base.author, base.artist, base.year, base.platform].filter(Boolean).join('|'))}`;
      const cached = await readCache(category, cacheKey);
      if (cached) {
        enriched = cached;
      } else {
        try {
          enriched = await cfg.enricher(base) || {};
          await writeCache(category, cacheKey, enriched);
        } catch (e) {
          console.warn(`  ! enrich failed for "${base.title}": ${e.message}`);
        }
      }
    }

    // Merge: Notion (base) wins over enrichment for non-null fields.
    const merged = { ...enriched };
    for (const [k, v] of Object.entries(base)) {
      if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) merged[k] = v;
      else if (!(k in merged)) merged[k] = v;
    }
    delete merged.notionCover;
    delete merged.overrideId;

    // Cover: prefer enriched (stable remote URL), fall back to Notion (which
    // expires after ~1hr — only used if you upload a cover directly to a
    // Notion page, which we don't do). We hotlink instead of downloading,
    // so no images get committed to the repo. Fallback URLs (e.g. iTunes
    // when CoverArtArchive 404s) are persisted so the browser can retry.
    const coverUrl = pick(enriched._coverUrl, base.notionCover);
    const fallbackUrls = enriched._coverFallbackUrls || [];
    delete merged._coverUrl;
    delete merged._coverFallbackUrls;
    if (coverUrl) {
      merged.cover = coverUrl;
      if (fallbackUrls.length) {
        merged.coverFallbacks = fallbackUrls;
      }
    }

    merged.category = category;
    items.push(merged);
  }

  await ensureDir(DATA_DIR);
  await fs.writeFile(
    path.join(DATA_DIR, `${category}.json`),
    JSON.stringify(items, null, 2)
  );
  console.log(`  ✓ wrote data/${category}.json (${items.length} items)`);
  return items;
}

function buildStats(allItems) {
  const totals = {};
  const byYear = {};
  const tagCounts = {};
  for (const i of allItems) {
    totals[i.category] = (totals[i.category] || 0) + 1;
    const y = i.year || (i.dateFinished || i.date || i.dateAdded || '').slice(0, 4);
    if (y) {
      byYear[i.category] = byYear[i.category] || {};
      byYear[i.category][y] = (byYear[i.category][y] || 0) + 1;
    }
    const tags = [...(i.tags || []), ...(Array.isArray(i.genre) ? i.genre : i.genre ? [i.genre] : [])];
    for (const t of tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  return { totals, byYear, topTags, generatedAt: new Date().toISOString() };
}

// ---------- Run ----------

async function main() {
  await ensureDir(DATA_DIR);

  const all = [];
  for (const [category, dbId] of Object.entries(databases)) {
    if (category.startsWith('_')) continue;
    const items = await processCategory(category, dbId);
    all.push(...items);
  }

  await fs.writeFile(path.join(DATA_DIR, 'all.json'), JSON.stringify(all, null, 2));
  console.log(`\n✓ wrote data/all.json (${all.length} items total)`);

  const stats = buildStats(all);
  await fs.writeFile(path.join(DATA_DIR, 'stats.json'), JSON.stringify(stats, null, 2));
  console.log(`✓ wrote data/stats.json`);

  // Stamp pages with last-updated date.
  const stamp = stats.generatedAt.slice(0, 10);
  for (const file of await collectHtmlFiles(ROOT)) {
    const text = await fs.readFile(file, 'utf8');
    if (text.includes('data-last-updated="')) {
      await fs.writeFile(file, text.replace(/data-last-updated="[^"]*"/, `data-last-updated="${stamp}"`));
    }
  }

  console.log('\n♡ done!');
}

async function collectHtmlFiles(dir) {
  const out = [];
  async function walk(d) {
    for (const ent of await fs.readdir(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'scripts') continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.name.endsWith('.html')) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

main().catch(e => {
  console.error('\n✖ build failed:', e);
  process.exit(1);
});
