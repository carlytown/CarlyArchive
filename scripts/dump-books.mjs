import 'dotenv/config';
import { Client } from '@notionhq/client';
import dbs from './databases.json' with { type: 'json' };
const n = new Client({ auth: process.env.NOTION_TOKEN });
const r = await n.databases.query({ database_id: dbs.books });
for (const p of r.results) {
  console.log('--- Page properties ---');
  for (const [k, v] of Object.entries(p.properties)) {
    let val;
    if (v.type === 'title') val = v.title?.[0]?.plain_text;
    else if (v.type === 'rich_text') val = v.rich_text?.[0]?.plain_text;
    else if (v.type === 'url') val = v.url;
    else if (v.type === 'select') val = v.select?.name;
    else if (v.type === 'checkbox') val = v.checkbox;
    else if (v.type === 'date') val = v.date?.start;
    else val = `(${v.type})`;
    console.log(`  [${v.type}] ${k}: ${val}`);
  }
}
