// One-time (re-runnable) seeder for the Pokémon Cards Notion database.
//
// Reads scripts/pokemon-config.json for the list of artists, queries
// pokemontcg.io for every card by those artists, and creates one Notion row
// per card so you never have to type them by hand. It is idempotent: cards
// that already exist (matched by "Card ID") are skipped, so you can re-run it
// after adding new artists.
//
// You only ever edit two things per row in Notion afterwards:
//   • Owned    (checkbox)
//   • Language (multi-select: English, Japanese, …)
//
// Setup:
//   1. Create a Notion database named e.g. "Pokémon Cards" with properties:
//        Name      (Title)
//        Card ID   (Text)
//        Owned     (Checkbox)
//        Language  (Multi-select)
//        Set       (Text)
//        Number    (Text)
//        Artist    (Text)
//   2. Share it with your Notion integration.
//   3. Add its id to scripts/databases.json under "pokemon".
//   4. Run:  npm run seed:pokemon
import 'dotenv/config';
import { Client } from '@notionhq/client';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ROOT, fetchJson, rateLimit } from './lib/utils.mjs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error('✖ NOTION_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const databases = JSON.parse(
  await fs.readFile(path.join(ROOT, 'scripts', 'databases.json'), 'utf8')
);
const DB_ID = databases.pokemon;
if (!DB_ID) {
  console.error('✖ No "pokemon" database id in scripts/databases.json.');
  console.error('  Create the Notion database, share it with your integration, and add its id there.');
  process.exit(1);
}

const config = JSON.parse(
  await fs.readFile(path.join(ROOT, 'scripts', 'pokemon-config.json'), 'utf8')
);
const artists = (config.artists || []).filter(Boolean);
if (!artists.length) {
  console.error('✖ No artists listed in scripts/pokemon-config.json.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const API_KEY = process.env.POKEMON_TCG_API_KEY;
const apiHeaders = API_KEY ? { 'X-Api-Key': API_KEY } : {};

// Fetch every card for an artist, following pagination.
async function fetchCardsByArtist(artist) {
  const cards = [];
  let page = 1;
  const pageSize = 250;
  for (;;) {
    await rateLimit('api.pokemontcg.io', 250);
    const q = encodeURIComponent(`artist:"${artist}"`);
    const url = `https://api.pokemontcg.io/v2/cards?q=${q}&page=${page}&pageSize=${pageSize}&orderBy=set.releaseDate,number`;
    const res = await fetchJson(url, apiHeaders);
    const batch = res?.data || [];
    cards.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }
  return cards;
}

// Build the set of Card IDs already present in the database (one paginated pass).
async function existingCardIds() {
  const ids = new Set();
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_ID,
      start_cursor: cursor,
      page_size: 100
    });
    for (const pageRow of res.results) {
      const prop = pageRow.properties?.['Card ID'];
      const text = prop?.rich_text?.map(t => t.plain_text).join('') || '';
      if (text) ids.add(text.trim());
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return ids;
}

function richText(value) {
  return value ? [{ type: 'text', text: { content: String(value).slice(0, 2000) } }] : [];
}

async function createRow(card) {
  await notion.pages.create({
    parent: { database_id: DB_ID },
    properties: {
      Name: { title: richText(card.name || 'Unknown card') },
      'Card ID': { rich_text: richText(card.id) },
      Set: { rich_text: richText(card.set?.name) },
      Number: { rich_text: richText(card.number) },
      Artist: { rich_text: richText(card.artist) }
      // Owned (checkbox) defaults to unchecked; Language left empty.
    }
  });
}

async function main() {
  console.log(`→ Seeding Pokémon cards for: ${artists.join(', ')}`);

  console.log('  reading existing rows from Notion…');
  const existing = await existingCardIds();
  console.log(`  ${existing.size} card(s) already in the database`);

  // Gather all cards across artists, de-duplicated by Card ID.
  const byId = new Map();
  for (const artist of artists) {
    console.log(`  fetching cards by "${artist}" from pokemontcg.io…`);
    const cards = await fetchCardsByArtist(artist);
    console.log(`    ${cards.length} card(s) found`);
    for (const c of cards) if (c?.id) byId.set(c.id, c);
  }

  let created = 0;
  let skipped = 0;
  for (const card of byId.values()) {
    if (existing.has(card.id)) { skipped += 1; continue; }
    try {
      await createRow(card);
      created += 1;
      console.log(`    + ${card.name} (${card.set?.name} ${card.number}) [${card.id}]`);
    } catch (e) {
      console.warn(`    ! failed to create row for ${card.id}: ${e.message}`);
    }
  }

  console.log(`\n✓ done — created ${created}, skipped ${skipped} (already present).`);
  console.log('  Now open Notion, tick "Owned" and set "Language" on the cards you have,');
  console.log('  then run  npm run build:notion  to publish.');
}

main().catch(e => {
  console.error('\n✖ seeding failed:', e);
  process.exit(1);
});
