import 'dotenv/config';
import { Client } from '@notionhq/client';
import dbs from './databases.json' with { type: 'json' };

const n = new Client({ auth: process.env.NOTION_TOKEN });
const SENTIMENT_OPTIONS = [
  { name: 'favorite', color: 'pink' },
  { name: 'liked',    color: 'red' },
  { name: 'neutral',  color: 'gray' },
  { name: 'disliked', color: 'brown' }
];

const targets = process.argv.slice(2);
if (!targets.length) { console.error('usage: add-sentiment.mjs <category> [<category>...]'); process.exit(1); }

for (const cat of targets) {
  const id = dbs[cat];
  if (!id) { console.log(cat, 'no DB id, skipping'); continue; }
  try {
    await n.databases.update({
      database_id: id,
      properties: {
        Sentiment: { select: { options: SENTIMENT_OPTIONS } }
      }
    });
    console.log(cat, '✓ added Sentiment select');
  } catch (e) { console.log(cat, 'ERR', e.message); }
}
