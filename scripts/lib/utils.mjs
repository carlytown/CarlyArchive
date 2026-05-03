// Shared utilities for the build script.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CACHE_DIR = path.join(ROOT, 'scripts', '.cache');
export const COVERS_DIR = path.join(ROOT, 'assets', 'covers');

export async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

export function hash(str) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 16);
}

export async function readCache(category, key) {
  const file = path.join(CACHE_DIR, category, key + '.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

export async function writeCache(category, key, data) {
  const dir = path.join(CACHE_DIR, category);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, key + '.json'), JSON.stringify(data, null, 2));
}

export function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https') ? https : http).get(url, {
      headers: { 'User-Agent': 'CarlysArchive/0.1 (personal site)', 'Accept': 'application/json', ...headers }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchJson(next, headers));
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => { req.destroy(new Error(`Timeout: ${url}`)); });
  });
}

export function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fsSync.existsSync(dest)) return resolve(dest);
    fs.mkdir(path.dirname(dest), { recursive: true }).then(() => {
      const file = fsSync.createWriteStream(dest);
      const req = (url.startsWith('https') ? https : http).get(url, {
        headers: { 'User-Agent': 'CarlysArchive/0.1' }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          file.close();
          fsSync.unlinkSync(dest);
          const next = new URL(res.headers.location, url).toString();
          return resolve(downloadFile(next, dest));
        }
        if (res.statusCode >= 400) {
          file.close();
          fsSync.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      });
      req.on('error', (err) => {
        file.close();
        try { fsSync.unlinkSync(dest); } catch {}
        reject(err);
      });
    }).catch(reject);
  });
}

// Be polite: serialise calls to a given API host with a min delay.
const lastCallByHost = new Map();
export async function rateLimit(host, minMs = 250) {
  const last = lastCallByHost.get(host) || 0;
  const wait = Math.max(0, last + minMs - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastCallByHost.set(host, Date.now());
}

// ----- Notion property helpers -----
export function plainText(rich) {
  if (!Array.isArray(rich)) return '';
  return rich.map(t => t.plain_text).join('');
}

export function getProp(page, name) {
  // Notion property names are case-sensitive; do a fuzzy lookup so users
  // can spell things slightly differently in Notion.
  const props = page.properties || {};
  const exact = props[name];
  if (exact) return exact;
  const lc = name.toLowerCase();
  const found = Object.keys(props).find(k => k.toLowerCase() === lc);
  return found ? props[found] : null;
}

// Find the single title property of a Notion page (every DB has exactly one).
export function readTitle(page) {
  const props = page.properties || {};
  const titleKey = Object.keys(props).find(k => props[k]?.type === 'title');
  if (!titleKey) return null;
  return plainText(props[titleKey].title) || null;
}

export function readProp(page, name) {
  const p = getProp(page, name);
  if (!p) return null;
  switch (p.type) {
    case 'title': return plainText(p.title) || null;
    case 'rich_text': return plainText(p.rich_text) || null;
    case 'number': return p.number;
    case 'select': return p.select?.name || null;
    case 'multi_select': return p.multi_select.map(o => o.name);
    case 'status': return p.status?.name || null;
    case 'date': return p.date?.start || null;
    case 'url': return p.url || null;
    case 'checkbox': return p.checkbox;
    case 'files': {
      const f = p.files[0];
      if (!f) return null;
      return f.file?.url || f.external?.url || null;
    }
    case 'people': return p.people.map(x => x.name);
    default: return null;
  }
}

export function pageCover(page) {
  const c = page.cover;
  if (!c) return null;
  return c.external?.url || c.file?.url || null;
}

// Read all URLs from a Notion files & media property (e.g. photo galleries).
// Notion file URLs expire after ~1hr so the build needs to re-fetch regularly.
export function readFiles(page, name) {
  const p = getProp(page, name);
  if (!p || p.type !== 'files') return [];
  return (p.files || [])
    .map(f => f.file?.url || f.external?.url || null)
    .filter(Boolean);
}

// Pick first non-null
export function pick(...vals) {
  for (const v of vals) if (v != null && v !== '') return v;
  return null;
}
