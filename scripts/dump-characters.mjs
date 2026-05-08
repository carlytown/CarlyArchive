import 'dotenv/config';
import { Client } from '@notionhq/client';
import dbs from './databases.json' with { type: 'json' };

const n = new Client({ auth: process.env.NOTION_TOKEN });
const r = await n.databases.query({ database_id: dbs.characters });
for (const p of r.results) {
  const props = {};
  for (const [k, v] of Object.entries(p.properties)) {
    if (v.type === 'title') props[k] = v.title?.[0]?.plain_text;
    else if (v.type === 'rich_text') props[k] = v.rich_text?.[0]?.plain_text;
    else if (v.type === 'url') props[k] = v.url;
    else if (v.type === 'select') props[k] = v.select?.name;
  }
  console.log(JSON.stringify(props));
}
