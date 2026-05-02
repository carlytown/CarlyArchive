// Shared layout helpers: nav highlight, footer, sparkle toggle wiring.

export function injectFooter() {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  const lastUpdated = document.documentElement.dataset.lastUpdated || '';
  footer.innerHTML = `
    <hr class="cute" />
    <div class="blinkies" aria-hidden="true">
      <img src="${rel('assets/decor/blinkie-1.gif')}" alt="" onerror="this.style.display='none'" />
      <img src="${rel('assets/decor/blinkie-2.gif')}" alt="" onerror="this.style.display='none'" />
      <img src="${rel('assets/decor/blinkie-3.gif')}" alt="" onerror="this.style.display='none'" />
    </div>
    <marquee scrollamount="4">♡ thanks for visiting carly's archive ♡ best viewed with sparkles on ♡</marquee>
    <div>last updated: ${lastUpdated || 'never'}</div>
    <div style="margin-top:0.6rem;">
      <button id="sparkle-toggle" type="button">✨ toggle sparkles</button>
    </div>
    <div style="margin-top:0.4rem; font-size:0.85rem;">
      made with ♡ on a personal corner of the internet
    </div>
  `;
  document.body.appendChild(footer);
  const btn = footer.querySelector('#sparkle-toggle');
  btn.addEventListener('click', () => {
    if (typeof window.toggleSparkles === 'function') {
      const on = window.toggleSparkles();
      btn.textContent = on ? '✨ sparkles: on' : '✨ sparkles: off';
    }
  });
  if (typeof window.sparklesEnabled === 'function') {
    btn.textContent = window.sparklesEnabled() ? '✨ sparkles: on' : '✨ sparkles: off';
  }
}

// Resolve a path relative to the site root regardless of whether we're at
// /index.html or /pages/foo.html.
export function rel(path) {
  const prefix = location.pathname.includes('/pages/') ? '../' : './';
  return prefix + path;
}

export function highlightNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(a => {
    const href = a.getAttribute('href').split('/').pop();
    if (href === here) a.setAttribute('aria-current', 'page');
  });
}
