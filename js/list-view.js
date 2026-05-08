// Generic category-page list view: loads /data/<category>.json,
// renders cards, supports search/filter/sort, opens a modal for details.

import { rel } from './layout.js';

// Global cover-image fallback walker. When a hotlinked cover 404s, try the
// next URL in the data-fallbacks list (set on the <img> element). Hide on exhaustion.
if (typeof window !== 'undefined' && !window.__coverFallback) {
  window.__coverFallback = (img) => {
    let list;
    try { list = JSON.parse(img.dataset.fallbacks || '[]'); } catch { list = []; }
    const next = list.shift();
    img.dataset.fallbacks = JSON.stringify(list);
    if (next) {
      img.src = next;
    } else {
      img.style.visibility = 'hidden';
    }
  };
}

export async function initListView(opts) {
  const { category, fields = {}, sortable = [], filterable = [], seasonal = null } = opts;
  const container = document.getElementById('list-root');
  container.dataset.category = category;
  document.body.dataset.category = category;
  container.innerHTML = '<p class="empty-state">Loading…</p>';

  let items = [];
  try {
    const res = await fetch(rel(`data/${category}.json`));
    if (!res.ok) throw new Error('not found');
    items = await res.json();
  } catch (e) {
    container.innerHTML = `
      <p class="empty-state">
        No data yet for <strong>${category}</strong>.<br/>
        Add some entries in Notion and run the build script.
      </p>`;
    return;
  }

  // Seasonal hiding — e.g. Christmas albums only show in Nov/Dec.
  // seasonal = { tagField, tags: ['holiday'], months: [11, 12] }
  let seasonalHidden = 0;
  if (seasonal && Array.isArray(seasonal.months) && seasonal.months.length) {
    const now = new Date().getMonth() + 1; // 1..12
    if (!seasonal.months.includes(now)) {
      const tagSet = new Set((seasonal.tags || []).map(t => String(t).toLowerCase()));
      const field = seasonal.tagField || 'tags';
      const before = items.length;
      items = items.filter(it => {
        const v = it[field];
        if (!v) return true;
        const list = Array.isArray(v) ? v : [v];
        return !list.some(t => tagSet.has(String(t).toLowerCase()));
      });
      seasonalHidden = before - items.length;
    }
  }

  if (!items.length) {
    container.innerHTML = `<p class="empty-state">No entries yet — coming soon ♡</p>`;
    return;
  }

  // Build controls
  const controls = document.getElementById('list-controls');
  const filterOpts = filterable.map(f => {
    const values = [...new Set(items.flatMap(i => {
      const v = i[f];
      return Array.isArray(v) ? v : (v ? [v] : []);
    }))].sort();
    return `<label>${f}: <select data-filter="${f}"><option value="">all</option>${
      values.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('')
    }</select></label>`;
  }).join('');
  const sortOpts = sortable.length
    ? `<label>sort: <select data-sort>${sortable.map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
       <label><input type="checkbox" data-sort-desc checked /> desc</label>`
    : '';
  controls.innerHTML = `
    <label>search: <input type="search" data-search placeholder="title, tags…" /></label>
    ${filterOpts}
    ${sortOpts}
    <span data-count style="margin-left:auto;font-weight:700;"></span>
  `;

  function render() {
    const q = (controls.querySelector('[data-search]')?.value || '').toLowerCase().trim();
    const activeFilters = filterable.map(f => ({
      field: f,
      value: controls.querySelector(`[data-filter="${f}"]`)?.value || ''
    })).filter(f => f.value);
    const sortBy = controls.querySelector('[data-sort]')?.value;
    const sortDesc = controls.querySelector('[data-sort-desc]')?.checked;

    let view = items.filter(i => {
      if (q) {
        const hay = JSON.stringify(i).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const f of activeFilters) {
        const v = i[f.field];
        if (Array.isArray(v)) {
          if (!v.includes(f.value)) return false;
        } else if (v !== f.value) return false;
      }
      return true;
    });

    if (sortBy) {
      view.sort((a, b) => {
        const av = a[sortBy] ?? '';
        const bv = b[sortBy] ?? '';
        if (av < bv) return sortDesc ? 1 : -1;
        if (av > bv) return sortDesc ? -1 : 1;
        return 0;
      });
    }

    container.innerHTML = '';
    if (!view.length) {
      container.innerHTML = `<p class="empty-state">No matches.</p>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      view.forEach(item => grid.appendChild(makeCard(item, fields)));
      container.appendChild(grid);
    }
    controls.querySelector('[data-count]').textContent = `${view.length} item${view.length === 1 ? '' : 's'}`;
  }

  controls.addEventListener('input', render);
  controls.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const item = items.find(i => i.id === id);
    if (item) openModal(item, fields);
  });

  render();

  // Soft refresh hook for the dev watch server: re-fetch JSON and re-render
  // the grid without reloading the page (no flash).
  window.__softRefresh = async function () {
    try {
      const res = await fetch(rel(`data/${category}.json`) + `?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      items = await res.json();
      render();
    } catch {}
  };
}

function makeCard(item, fields) {
  const card = document.createElement('div');
  card.className = 'card' + (item.sentiment === 'favorite' ? ' is-favorite' : '');
  card.dataset.id = item.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Open details for ${item.title}`);
  const fallbackAttr = Array.isArray(item.coverFallbacks) && item.coverFallbacks.length
    ? ` data-fallbacks='${escapeAttr(JSON.stringify(item.coverFallbacks))}'`
    : '';
  const cover = item.cover
    ? `<img class="cover" src="${rel(item.cover)}" alt="Cover of ${escapeAttr(item.title)}" loading="lazy"${fallbackAttr} onerror="window.__coverFallback&&window.__coverFallback(this)" />`
    : `<img class="cover" src="" alt="" onerror="this.style.visibility='hidden'" />`;
  const meta = (fields.cardMeta || []).map(f => {
    const v = item[f];
    if (f === 'owned') return v === true ? `<div class="meta">📚 in my library</div>` : `<div class="meta"> does not own</div>`;
    if (v == null || v === '' || v === false) return '';
    if (f === 'status') return statusBadge(v);
    if (f === 'playcount') return `<div class="meta lf-playcount">♫ ${Number(v).toLocaleString()} plays</div>`;
    return `<div class="meta">${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}</div>`;
  }).join('');
  const rating = sentimentBadge(item.sentiment);
  const favStar = item.sentiment === 'favorite' ? `<span class="fav-star" aria-label="favorite" title="favorite">★</span>` : '';
  card.innerHTML = `
    <div class="cover-wrap">${cover}${favStar}</div>
    <div class="title">${escapeHtml(item.title || 'Untitled')}</div>
    ${meta}
  `;
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
  });
  return card;
}

function openModal(item, fields) {
  let backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }
  const modal = backdrop.querySelector('.modal');
  const modalFallbackAttr = Array.isArray(item.coverFallbacks) && item.coverFallbacks.length
    ? ` data-fallbacks='${escapeAttr(JSON.stringify(item.coverFallbacks))}'`
    : '';
  const cover = item.cover
    ? `<img class="cover-large" src="${rel(item.cover)}" alt="Cover of ${escapeAttr(item.title)}"${modalFallbackAttr} onerror="window.__coverFallback&&window.__coverFallback(this)" />`
    : '';
  const detailFields = fields.modal || Object.keys(item).filter(k => !['id', 'title', 'cover', 'coverFallbacks', 'review', 'notes', 'description'].includes(k));
  const dl = detailFields.map(f => {
    const v = item[f];
    if (v == null || v === '') return '';
    if (f === 'owned') {
      return v === true
        ? `<dt>📚 in my library</dt><dd></dd>`
        : `<dt>does not own</dt><dd></dd>`;
    }
    const value = Array.isArray(v) ? v.join(', ') : String(v);
    return `<dt>${escapeHtml(f)}</dt><dd>${escapeHtml(value)}</dd>`;
  }).join('');
  const review = item.review || item.notes || '';
  const description = item.description || '';
  modal.innerHTML = `
    <button class="close-btn" aria-label="Close">✕</button>
    ${cover}
    <h2>${escapeHtml(item.title)}</h2>
    ${sentimentBadge(item.sentiment, true)}
    <dl>${dl}</dl>
    ${description ? `<p style="font-style:italic;">${escapeHtml(description)}</p>` : ''}
    ${review ? `<div class="review"><strong>my notes:</strong>\n${escapeHtml(review)}</div>` : ''}
  `;
  modal.querySelector('.close-btn').addEventListener('click', closeModal);
  backdrop.classList.add('open');
}

function closeModal() {
  const b = document.getElementById('modal-backdrop');
  if (b) b.classList.remove('open');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Map of common status values -> { icon, bg, fg }.
// Lookup is case-insensitive and tolerant of small wording variations.
const STATUS_STYLES = [
  { match: /^(done|read|watched|played|finished|completed|owned|attended|visited)$/i,
    icon: '♥', bg: '#ff6fb5', fg: '#fff' },
  { match: /^(in progress|reading|watching|playing|currently)/i,
    icon: '✿', bg: '#b6f7d8', fg: '#3a0a2a' },
  { match: /^(on hold|paused)$/i,
    icon: '☾', bg: '#ffe066', fg: '#3a0a2a' },
  { match: /^(dropped|abandoned|did not finish|dnf)$/i,
    icon: '💔', bg: '#3a0a2a', fg: '#ffd1e8' },
  { match: /^(plan to|want to|wishlist|backlog|haven['’]?t started|not started|to read|to watch|to play)/i,
    icon: '✧', bg: '#e7c6ff', fg: '#3a0a2a' }
];

function statusBadge(value) {
  const v = String(value).trim();
  const style = STATUS_STYLES.find(s => s.match.test(v))
    || { icon: '✦', bg: 'var(--pink-baby)', fg: 'var(--plum)' };
  return `<div class="status-badge" style="
    display:inline-block;
    background:${style.bg};
    color:${style.fg};
    border:1.5px solid var(--plum);
    border-radius:999px;
    padding:0.15rem 0.55rem;
    font-size:0.78rem;
    font-weight:700;
    margin:0.3rem 0 0.1rem;
    white-space:nowrap;
  ">${style.icon} ${escapeHtml(v.toLowerCase())}</div>`;
}
function escapeAttr(s) { return escapeHtml(s); }

const SENTIMENT_DISPLAY = {
  favorite: { icon: '💖', label: 'favorite' },
  liked:    { icon: '💕', label: 'liked' },
  neutral:  { icon: '😐', label: 'neutral' },
  disliked: { icon: '💔', label: 'disliked' }
};
function sentimentBadge(value, large = false) {
  if (!value) return '';
  const v = String(value).toLowerCase();
  const s = SENTIMENT_DISPLAY[v];
  if (!s) return '';
  const size = large ? 'font-size:1rem;padding:0.25rem 0.7rem;' : 'font-size:0.78rem;padding:0.15rem 0.55rem;';
  return `<div class="sentiment-badge" style="display:inline-block;background:var(--pink-baby);color:var(--plum);border:1.5px solid var(--plum);border-radius:999px;${size}font-weight:700;margin:0.3rem 0 0.1rem;white-space:nowrap;">${s.icon} ${s.label}</div>`;
}
