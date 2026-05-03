import fs from 'fs';
const d = JSON.parse(fs.readFileSync('data/cds.json'));
console.log('Total CDs:', d.length);
const missing = d.filter(c => !c.cover);
console.log('Missing covers:', missing.length);
missing.forEach(c => console.log('  -', c.title, '|', c.artist || '(no artist)', c.overrideId ? '(override:' + c.overrideId + ')' : ''));
