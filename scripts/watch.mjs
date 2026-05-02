// Local dev: builds once, serves the site, polls Notion every N minutes,
// and notifies connected browsers (via Server-Sent Events) to reload after
// each successful build.
//
// Usage: npm run watch
// Env:   WATCH_INTERVAL_MS (default 120000 = 2 min), PORT (default 3000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const INTERVAL = Number(process.env.WATCH_INTERVAL_MS || 120_000);

const MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2'
};

const sseClients = new Set();
let buildInFlight = false;
// Hash of data/ contents from the last build. We only notify clients when
// it actually changes, so a build that produced no diff is silent.
let lastDataHash = '';
let lastSrcHash = hashSrc();

function hashDataDir() {
  const dataDir = path.join(ROOT, 'data');
  if (!fs.existsSync(dataDir)) return '';
  const h = crypto.createHash('sha1');
  for (const name of fs.readdirSync(dataDir).sort()) {
    if (!name.endsWith('.json')) continue;
    h.update(name);
    h.update(fs.readFileSync(path.join(dataDir, name)));
  }
  return h.digest('hex');
}

// Hash of source files we want to trigger a hard reload for (HTML/CSS/JS).
function hashSrc() {
  const h = crypto.createHash('sha1');
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules' ||
          ent.name === 'data' || ent.name === 'assets' || ent.name === 'scripts') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(html|css|js|mjs)$/.test(ent.name)) {
        h.update(p);
        h.update(fs.readFileSync(p));
      }
    }
  }
  walk(ROOT);
  return h.digest('hex');
}

function pingClients(event, payload = '') {
  for (const res of sseClients) {
    try { res.write(`event: ${event}\ndata: ${payload}\n\n`); } catch {}
  }
}

function checkSrc() {
  const h = hashSrc();
  if (h !== lastSrcHash) {
    lastSrcHash = h;
    pingClients('reload', 'src');
  }
}

function runBuild() {
  if (buildInFlight) return Promise.resolve();
  buildInFlight = true;
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn('node', ['scripts/fetch-notion.mjs'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => out += d);
    child.on('close', (code) => {
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      buildInFlight = false;
      if (code === 0) {
        const newHash = hashDataDir();
        const changed = newHash !== lastDataHash;
        lastDataHash = newHash;
        if (changed) {
          process.stdout.write(`\n[watch] build ok in ${dur}s — data changed, notifying browsers ✨\n`);
          const lines = out.split('\n').filter(l => /✓|✖|!|→/.test(l));
          for (const l of lines) console.log('  ' + l.trim());
          pingClients('data-changed', newHash);
        } else {
          process.stdout.write(`[watch] build ok in ${dur}s — no changes\r`);
        }
      } else {
        process.stdout.write(`\n[watch] build FAILED (exit ${code}) in ${dur}s\n`);
        console.log(out);
      }
      resolve();
    });
  });
}

// Inject a tiny client that listens for SSE events and either soft-refreshes
// data (no flash) or does a full reload only when source files change.
const RELOAD_SCRIPT = `
<script>
(function () {
  if (window.__sseHooked) return; window.__sseHooked = true;
  var es = new EventSource('/__events');
  es.addEventListener('reload', function () { location.reload(); });
  es.addEventListener('data-changed', function () {
    // Soft refresh: re-fetch the JSON the page is using and rerender in place.
    if (typeof window.__softRefresh === 'function') {
      window.__softRefresh();
    } else {
      // No soft-refresh hook on this page — fall back to silent reload.
      location.reload();
    }
  });
  es.onerror = function () { /* server may be restarting */ };
})();
</script>
`;

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(base)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  if (req.url === '/__events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(`event: hello\ndata: ${lastDataHash}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.url === '/__rebuild') {
    runBuild();
    res.writeHead(202, { 'Content-Type': 'text/plain' });
    res.end('rebuilding\n');
    return;
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = safeJoin(ROOT, urlPath);
  if (!filePath) { res.writeHead(403); return res.end('forbidden'); }

  try {
    const st = fs.statSync(filePath);
    if (st.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {}

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const fb = path.join(ROOT, '404.html');
      if (fs.existsSync(fb) && (filePath.endsWith('.html') || !path.extname(filePath))) {
        const html = fs.readFileSync(fb, 'utf8');
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html.replace('</body>', RELOAD_SCRIPT + '</body>'));
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found: ' + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIMES[ext] || 'application/octet-stream';
    if (ext === '.html') {
      const html = data.toString('utf8').replace('</body>', RELOAD_SCRIPT + '</body>');
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, async () => {
  console.log(`\n♡ Carly's Archive (watch mode)`);
  console.log(`  serving:    http://localhost:${PORT}`);
  console.log(`  rebuilds:   every ${(INTERVAL / 1000).toFixed(0)}s — only notifies on real changes ♡`);
  console.log(`  manual:     http://localhost:${PORT}/__rebuild`);
  console.log(`  press Ctrl+C to stop\n`);
  await runBuild();
  setInterval(runBuild, INTERVAL);
  setInterval(checkSrc, 1000); // hot-reload on local code edits
});
