import 'dotenv/config';
import { Client } from '@notionhq/client';
import dbs from './databases.json' with { type: 'json' };

const n = new Client({ auth: process.env.NOTION_TOKEN });
for (const [cat, id] of Object.entries(dbs)) {
  if (!id || cat.startsWith('_')) continue;
  try {
    const db = await n.databases.retrieve({ database_id: id });
    const props = Object.keys(db.properties);
    const hasSent = props.some(p => p.toLowerCase() === 'sentiment');
    const hasRating = props.some(p => p.toLowerCase() === 'rating');
    const flag = hasSent && !hasRating ? 'OK     ' : hasSent && hasRating ? 'BOTH   ' : hasRating ? 'NEEDS  ' : 'NEITHER';
    console.log(cat.padEnd(12), flag, '  props:', props.join(', '));
  } catch (e) { console.log(cat, 'ERR', e.message); }
}
