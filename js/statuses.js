// Status feed: renders Twitter-style posts from data/statuses.json.
// Used by both the home sidebar widget and the dedicated /pages/statuses.html.

import { rel } from './layout.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// "just now" / "5m ago" / "3h ago" / "yesterday" / "Apr 12"
export function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const now = new Date();
  const sec = Math.max(0, (now - then) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 90) return '1m ago';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  // Fall back to a date label.
  return then.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  });
}

// Linkify URLs and #hashtags in body text. Returns escaped HTML.
function linkify(text) {
  let out = escapeHtml(text);
  out = out.replace(/(https?:\/\/[^\s<]+)/g, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  out = out.replace(/(^|\s)#([a-z0-9_]+)/gi, (_, pre, tag) => `${pre}<span class="status-tag">#${tag}</span>`);
  return out.replace(/\n/g, '<br/>');
}

function moodEmoji(mood) {
  // Deprecated — emoji now comes from a dedicated field. Kept as a no-op
  // for backwards compatibility in case anything else imports it.
  return '';
}

function statusCard(s) {
  // User-supplied emoji wins; otherwise leave it blank (mood is now a
  // freeform label that gets shown beside the time).
  const emoji = (s.emoji || '').trim();
  const emojiEl = emoji ? `<span class="status-mood" aria-hidden="true">${escapeHtml(emoji)}</span>` : '';
  const moodLabel = s.mood ? `<span class="status-mood-label">feeling ${escapeHtml(s.mood)}</span>` : '';
  const time = s.posted
    ? `<time class="status-time" datetime="${escapeHtml(s.posted)}" title="${escapeHtml(new Date(s.posted).toLocaleString())}">${escapeHtml(relativeTime(s.posted))}</time>`
    : '';
  const body = s.body ? `<div class="status-body">${linkify(s.body)}</div>` : '';
  const tags = (s.tags && s.tags.length)
    ? `<div class="status-tags">${s.tags.map(t => `<span class="status-tag">#${escapeHtml(t)}</span>`).join(' ')}</div>`
    : '';
  const meta = (moodLabel || time)
    ? `<div class="status-meta">${moodLabel}${time}</div>`
    : '';
  return `
    <article class="status">
      <div class="status-head">
        ${emojiEl}
        <div class="status-text">${linkify(s.text || '')}</div>
      </div>
      ${body}
      ${tags}
      ${meta}
    </article>
  `;
}

// Render a list of statuses into the given root element.
// opts: { limit?: number, emptyMsg?: string }
export async function renderStatuses(rootSelector, opts = {}) {
  const root = typeof rootSelector === 'string' ? document.querySelector(rootSelector) : rootSelector;
  if (!root) return;
  let items;
  try {
    const res = await fetch(rel('data/statuses.json') + `?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('not found');
    items = await res.json();
  } catch {
    root.innerHTML = `<p class="empty-state">${escapeHtml(opts.emptyMsg || 'no statuses yet ♡')}</p>`;
    return;
  }
  // Sort newest first.
  items.sort((a, b) => (b.posted || '').localeCompare(a.posted || ''));
  if (opts.limit) items = items.slice(0, opts.limit);
  if (!items.length) {
    root.innerHTML = `<p class="empty-state">${escapeHtml(opts.emptyMsg || 'no statuses yet ♡')}</p>`;
    return;
  }
  root.innerHTML = items.map(statusCard).join('');
}

// Soft-refresh hook so the watch loop can update without a full reload.
if (typeof window !== 'undefined') {
  window.__statusRefresh = (sel, opts) => renderStatuses(sel, opts);
}
