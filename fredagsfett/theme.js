/* QoL #26 — Fredagsfett theme cycler.
 *
 * Loaded by /fredagsfett/{kalender,karta,sp1wise}/index.html. Applies the
 * persisted theme to <body> before the rest of the page renders, and
 * injects a floating cycler button at the bottom-right of the viewport.
 *
 * Themes (all keyed off body classes; see fredagsfett/light-ui.css):
 *   - gotland     (default, no class)         cream limestone + sage lichen
 *   - whisky      body.ff-theme-whisky        old gallery dark amber
 *   - midsommar   body.ff-theme-midsommar     pale yellow + cornflower blue
 */

(function () {
  const THEMES = [
    { id: 'gotland',   label: 'Gotland · sten',     dot: '#6c7450' },
    { id: 'whisky',    label: 'Galleri · whisky',   dot: '#a4925d' },
    { id: 'midsommar', label: 'Midsommar · gul',    dot: '#d8c46a' },
  ];
  const STORAGE_KEY = 'ff-theme';
  const VALID = new Set(THEMES.map(t => t.id));

  function readTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return VALID.has(v) ? v : 'gotland';
    } catch { return 'gotland'; }
  }
  function applyTheme(id) {
    document.body.classList.remove('ff-theme-whisky', 'ff-theme-midsommar');
    if (id === 'whisky')    document.body.classList.add('ff-theme-whisky');
    if (id === 'midsommar') document.body.classList.add('ff-theme-midsommar');
  }
  function persistTheme(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  }

  let current = readTheme();
  // Apply asap so the first paint reflects the persisted choice.
  // (Even if this script loads at the bottom of <body>, the FOUC is one frame.)
  if (document.body) applyTheme(current);
  else document.addEventListener('DOMContentLoaded', () => applyTheme(current), { once: true });

  function nextTheme() {
    const idx = THEMES.findIndex(t => t.id === current);
    return THEMES[(idx + 1) % THEMES.length].id;
  }

  function injectButton() {
    if (document.getElementById('ff-theme-cycler')) return;
    const btn = document.createElement('button');
    btn.id = 'ff-theme-cycler';
    btn.type = 'button';
    btn.className = 'ff-theme-cycler';
    btn.setAttribute('aria-label', 'Byt tema');
    render();
    btn.addEventListener('click', () => {
      current = nextTheme();
      applyTheme(current);
      persistTheme(current);
      render();
      // Echo a small toast if the page provides one
      const t = window.showToast;
      if (typeof t === 'function') {
        const label = (THEMES.find(x => x.id === current) || THEMES[0]).label;
        t(`Tema: ${label}`);
      }
    });
    document.body.appendChild(btn);

    function render() {
      const meta = THEMES.find(t => t.id === current) || THEMES[0];
      btn.innerHTML = `<span class="dot" style="background:${meta.dot}"></span><span class="lbl">${meta.label}</span>`;
      btn.title = `Tema: ${meta.label} — klicka för att växla`;
    }
  }
  // QoL #27 — Mobile bottom tab bar. Injected once. CSS in light-ui.css
  // shows it only at ≤ 720px so desktop keeps the topbar.
  function injectMobileTabbar() {
    if (document.getElementById('ff-mobile-tabbar')) return;
    const path = location.pathname;
    const tabs = [
      { href: '/fredagsfett/hem',      ic: '⌂',  label: 'Hem' },
      { href: '/fredagsfett/kalender', ic: '◷',  label: 'Kalender' },
      { href: '/fredagsfett/sp1wise',  ic: '∑',  label: 'SP1Wise' },
      { href: '/fredagsfett/karta',    ic: '◐',  label: 'Karta' },
    ];
    const wrap = document.createElement('div');
    wrap.id = 'ff-mobile-tabbar';
    wrap.className = 'ff-mobile-tabbar';
    wrap.innerHTML = `<nav aria-label="Mobil navigation">${
      tabs.map(t => {
        const active = path.startsWith(t.href) ? ' aria-current="page"' : '';
        return `<a href="${t.href}"${active}><span class="ic" aria-hidden="true">${t.ic}</span><span>${t.label}</span></a>`;
      }).join('')
    }</nav>`;
    document.body.appendChild(wrap);
  }

  // QoL #22 — Foreground browser notifications (lite, no Service Worker).
  // We don't ship a real push subscription pipeline here — instead, when the
  // page is hidden and a poll discovers something new (new locked event, new
  // chat message), pages can call window.ffNotify(title, body) to surface a
  // native OS notification. The bootstrap below seeds an opt-in toggle and
  // exposes the helper globally.
  const NOTIF_KEY = 'ff-notifications';
  function notifOptIn() {
    try { return localStorage.getItem(NOTIF_KEY) === '1'; } catch { return false; }
  }
  function notifSet(v) {
    try { localStorage.setItem(NOTIF_KEY, v ? '1' : '0'); } catch {}
  }
  window.ffNotify = function (title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!notifOptIn()) return;
    // Don't fire when the tab is visible — the in-page UI already shows it.
    if (!document.hidden) return;
    try { new Notification(title, { body, icon: '/favicon.ico', silent: false }); }
    catch {}
  };
  window.ffRequestNotificationPermission = async function () {
    if (!('Notification' in window)) return 'denied';
    try {
      const result = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      if (result === 'granted') notifSet(true);
      return result;
    } catch { return 'denied'; }
  };
  window.ffNotifOptIn = notifOptIn;
  window.ffNotifSet = notifSet;

  function bootstrap() {
    injectButton();
    injectMobileTabbar();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
