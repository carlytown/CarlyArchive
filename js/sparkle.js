// Sparkle cursor trail — extra dramatic edition.
// Off automatically with prefers-reduced-motion. Toggle persists in localStorage.

(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stored = localStorage.getItem('sparkleCursor');
  let enabled = !reduced && stored !== 'off';

  const COLORS = ['#ff6fb5', '#ff4fa3', '#ffd1e8', '#e7c6ff', '#ffffff', '#ffe066'];
  const EMOJIS = ['✦', '✧', '★', '☆', '♡', '✿', '❀', '✨'];

  if (!document.getElementById('sparkle-keyframes')) {
    const style = document.createElement('style');
    style.id = 'sparkle-keyframes';
    style.textContent = `
      @keyframes sparkle-fall {
        0%   { transform: translate(0,0) rotate(0deg) scale(1); opacity: 1; }
        60%  { opacity: 1; }
        100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.2); opacity: 0; }
      }
      .sparkle-emoji {
        position: fixed;
        pointer-events: none;
        z-index: 9999;
        font-size: var(--size, 22px);
        line-height: 1;
        text-shadow: 0 0 6px var(--glow, #fff), 0 0 12px var(--glow, #ff6fb5);
        animation: sparkle-fall var(--dur, 900ms) ease-out forwards;
        will-change: transform, opacity;
      }
    `;
    document.head.appendChild(style);
  }

  function spawn(x, y) {
    if (!enabled) return;
    const count = 2 + Math.floor(Math.random() * 2); // 2-3 per move
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'sparkle-emoji';
      s.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const size = 14 + Math.random() * 22;
      const jitterX = (Math.random() - 0.5) * 30;
      const jitterY = (Math.random() - 0.5) * 30;
      const dx = (Math.random() - 0.5) * 90;
      const dy = 30 + Math.random() * 80;
      const rot = (Math.random() - 0.5) * 720;
      const dur = 700 + Math.random() * 700;

      s.style.left = (x + jitterX - size / 2) + 'px';
      s.style.top  = (y + jitterY - size / 2) + 'px';
      s.style.color = color;
      s.style.setProperty('--size', size + 'px');
      s.style.setProperty('--dx', dx + 'px');
      s.style.setProperty('--dy', dy + 'px');
      s.style.setProperty('--rot', rot + 'deg');
      s.style.setProperty('--dur', dur + 'ms');
      s.style.setProperty('--glow', color);
      document.body.appendChild(s);
      setTimeout(() => s.remove(), dur + 50);
    }
  }

  let last = 0;
  document.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - last < 18) return;
    last = now;
    spawn(e.clientX, e.clientY);
  });

  document.addEventListener('click', (e) => {
    if (!enabled) return;
    for (let i = 0; i < 12; i++) spawn(e.clientX, e.clientY);
  });

  window.toggleSparkles = function () {
    enabled = !enabled;
    localStorage.setItem('sparkleCursor', enabled ? 'on' : 'off');
    return enabled;
  };
  window.sparklesEnabled = () => enabled;
})();
