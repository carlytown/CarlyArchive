// Renders the music page (top albums / artists / recent) and the
// home-page now-playing widget, both fed by data/lastfm.json.
//
// For the *now-playing* track specifically we hit Last.fm's public API
// directly so it updates in near-real time. The API key in window.LASTFM
// is read-only and safe to expose (it's the same scope you'd get on any
// last.fm embed widget).

const LASTFM_CONFIG_URL = 'data/lastfm-config.json';
const POLL_INTERVAL_MS = 30_000; // refresh now-playing every 30s

let lfmConfig = null;
async function getLfmConfig(base) {
  if (lfmConfig) return lfmConfig;
  try {
    const res = await fetch(`${base}${LASTFM_CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) lfmConfig = await res.json();
  } catch {}
  return lfmConfig;
}

async function fetchLiveNowPlaying(base) {
  const cfg = await getLfmConfig(base);
  if (!cfg?.apiKey || !cfg?.user) return undefined; // signal "no live data"
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(cfg.user)}&api_key=${encodeURIComponent(cfg.apiKey)}&limit=1&format=json`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = await res.json();
    const t = data?.recenttracks?.track;
    const track = Array.isArray(t) ? t[0] : t;
    if (!track) return null;
    return {
      name:    track.name,
      artist:  track.artist?.['#text'] || '',
      album:   track.album?.['#text'] || '',
      url:     track.url,
      image:   bestImage(track.image),
      nowPlaying: track['@attr']?.nowplaying === 'true',
      uts:     track.date?.uts ? Number(track.date.uts) : null
    };
  } catch {
    return undefined;
  }
}

function bestImage(images) {
  if (!Array.isArray(images)) return null;
  for (const size of ['mega', 'extralarge', 'large', 'medium', 'small']) {
    const m = images.find(i => i.size === size && i['#text']);
    if (m) return m['#text'];
  }
  return null;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

function timeAgo(uts) {
  if (!uts) return '';
  const diff = Date.now() / 1000 - uts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function albumCard(a, base = '') {
  const src = a.image
    ? (a.image.startsWith('http') ? a.image : base + a.image)
    : null;
  const img = src
    ? `<img class="cover" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
    : `<div class="cover lf-cover-fallback">♫</div>`;
  return `
    <a class="card lf-album-card" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
      ${img}
      <div class="title">${escapeHtml(a.name)}</div>
      <div class="meta">${escapeHtml(a.artist)}</div>
      <div class="lf-playcount">♫ ${a.playcount.toLocaleString()} plays</div>
    </a>
  `;
}

function nowPlayingCard(t, base = '', { live = false } = {}) {
  if (!t) return `
    <div class="lf-now lf-now-idle">
      <span class="lf-now-icon">♫</span>
      <div>
        <div class="lf-now-label">not listening right now</div>
        <div class="lf-now-sub">last.fm scrobbles</div>
      </div>
    </div>`;
  const src = t.image
    ? (t.image.startsWith('http') ? t.image : base + t.image)
    : null;
  const img = src
    ? `<img class="lf-now-art" src="${escapeHtml(src)}" alt="" onerror="this.style.display='none'" />`
    : `<div class="lf-now-art lf-cover-fallback">♫</div>`;
  let label;
  if (t.nowPlaying) {
    label = `<span class="lf-pulse">●</span> now playing`;
  } else if (t.uts) {
    label = `last played ${escapeHtml(timeAgo(t.uts))}`;
  } else {
    label = `recently played`;
  }
  return `
    <a class="lf-now ${t.nowPlaying ? 'lf-now-playing' : 'lf-now-recent'}" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">
      ${img}
      <div class="lf-now-text">
        <div class="lf-now-label">${label}</div>
        <div class="lf-now-track">${escapeHtml(t.name)}</div>
        <div class="lf-now-sub">${escapeHtml(t.artist)}${t.album ? ' &middot; ' + escapeHtml(t.album) : ''}</div>
      </div>
    </a>
  `;
}

function pickFromCache(data) {
  return data?.nowPlaying || data?.recent?.[0] || null;
}

// Render the now-playing element from cache, then upgrade to live data if
// possible, then keep polling every POLL_INTERVAL_MS.
function startLivePolling(el, base, cachedTrack) {
  let current = cachedTrack;
  const update = (track) => {
    if (track === undefined) return; // fetch failed — keep showing what we have
    if (!track && !current) return;
    if (track && current &&
        track.name === current.name &&
        track.artist === current.artist &&
        track.nowPlaying === current.nowPlaying) {
      return; // no change
    }
    current = track;
    el.innerHTML = nowPlayingCard(track, base, { live: true });
  };
  fetchLiveNowPlaying(base).then(update);
  const id = setInterval(() => fetchLiveNowPlaying(base).then(update), POLL_INTERVAL_MS);
  // Pause polling when tab is hidden, refresh immediately when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fetchLiveNowPlaying(base).then(update);
  });
  return id;
}

export async function renderMusicPage(base = '') {
  let data;
  try {
    const res = await fetch(`${base}data/lastfm.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('no data');
    data = await res.json();
  } catch {
    document.querySelector('.main').innerHTML =
      `<p class="empty-state">No Last.fm data yet — run <code>npm run build</code> with a <code>LASTFM_API_KEY</code> set.</p>`;
    return;
  }

  const np = document.getElementById('now-playing-section');
  const cachedTrack = pickFromCache(data);
  np.innerHTML = nowPlayingCard(cachedTrack, base);
  startLivePolling(np, base, cachedTrack);

  // Period tabs
  const periods = data.periods || [{ key: 'overall', label: 'all time' }];
  const tabsEl = document.getElementById('period-tabs');
  const STORE_KEY = 'lf-period';
  const initial = localStorage.getItem(STORE_KEY) || 'overall';
  const validInitial = periods.find(p => p.key === initial)?.key || 'overall';

  tabsEl.innerHTML = periods.map(p => `
    <button type="button" class="lf-period-tab" data-period="${p.key}" aria-pressed="${p.key === validInitial}">${p.label}</button>
  `).join('');

  function renderPeriod(key) {
    const slice = data.byPeriod?.[key] || { topArtists: data.topArtists, topAlbums: data.topAlbums };
    const label = periods.find(p => p.key === key)?.label || '';
    document.querySelectorAll('[data-period-label]').forEach(el => el.textContent = `(${label})`);

    document.getElementById('top-albums').innerHTML =
      slice.topAlbums.map(a => albumCard(a, base)).join('');

    const max = Math.max(...slice.topArtists.map(a => a.playcount), 1);
    document.getElementById('top-artists').innerHTML = slice.topArtists.map((a, i) => `
      <li class="lf-artist-row">
        <span class="lf-rank">#${i + 1}</span>
        <a class="lf-artist-name" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a>
        <span class="lf-bar"><span class="lf-bar-fill" style="width:${(a.playcount / max * 100).toFixed(1)}%"></span></span>
        <span class="lf-playcount">${a.playcount.toLocaleString()}</span>
      </li>
    `).join('');

    tabsEl.querySelectorAll('.lf-period-tab').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.period === key ? 'true' : 'false');
    });
  }

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.lf-period-tab');
    if (!btn) return;
    const key = btn.dataset.period;
    localStorage.setItem(STORE_KEY, key);
    renderPeriod(key);
  });

  renderPeriod(validInitial);

  document.getElementById('recent-scrobbles').innerHTML = data.recent.map(t => `
    <li class="lf-recent-row">
      <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">
        <span class="lf-recent-track">${escapeHtml(t.name)}</span>
        <span class="lf-recent-artist">— ${escapeHtml(t.artist)}</span>
      </a>
      <span class="lf-recent-when">${escapeHtml(timeAgo(t.uts) || t.date || '')}</span>
    </li>
  `).join('');
}

// For the home page sidebar — small, just the current/last track.
export async function renderNowPlayingWidget(target, base = '') {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;
  let cachedTrack = null;
  try {
    const res = await fetch(`${base}data/lastfm.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      cachedTrack = pickFromCache(data);
    }
  } catch {}
  el.innerHTML = nowPlayingCard(cachedTrack, base);
  startLivePolling(el, base, cachedTrack);
}

