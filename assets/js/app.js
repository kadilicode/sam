/* ==========================================================================
   THE CURRENT INVESTMENT — app.js
   Boot sequence, hash router, app shell, theme, branding and shortcuts.
   ========================================================================== */
(function (KR) {
  'use strict';

  const U = KR.U;
  const UI = KR.UI;
  const DB = KR.DB;
  const Auth = KR.Auth;

  const ROUTES = {
    invoices: 'Invoices',
    'invoice-create': 'New invoice',
    settings: 'Settings',
    backup: 'Backup and restore'
  };

  const THEME_KEY = 'tci_theme';

  let current = null;      // { name, page, hash }
  let renderToken = 0;
  let bypassGuard = false;
  let lastHash = '';
  let appVisible = false;

  const view = () => document.getElementById('view');

  const parseHash = () => {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    const params = {};
    new URLSearchParams(query || '').forEach((v, k) => { params[k] = v; });
    return { page: path || 'invoices', params };
  };

  const App = {
    /* ---------------- Navigation ---------------- */
    go(page, params = {}, replace = false) {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString();
      const hash = `#/${page}${qs ? '?' + qs : ''}`;
      if (location.hash === hash) { App.render(); return; }
      if (replace) {
        history.replaceState(null, '', hash);
        lastHash = hash;
        App.render();
      } else {
        location.hash = hash;
      }
    },

    async render() {
      if (!appVisible) return;
      if (!Auth.isLoggedIn()) { App.signOut('Your session has ended. Sign in again to continue.'); return; }

      let { page, params } = parseHash();
      if (!ROUTES[page] || !KR.Pages[page]) {
        page = 'invoices';
        params = {};
        history.replaceState(null, '', '#/invoices');
      }
      lastHash = location.hash;
      const token = ++renderToken;
      const focusWasInNav = !!(document.activeElement && document.activeElement.closest('.sidebar, .tabbar, .topbar'));

      if (current && current.page.destroy) {
        try { current.page.destroy(); } catch (e) { /* ignore */ }
      }
      current = null;
      UI.closeMenu();
      UI.closeAllModals();
      App.closeDrawer();
      App.hideTip();

      const v = view();
      v.innerHTML = '';
      const root = document.createElement('div');
      root.className = `page page-${page}`;
      v.appendChild(root);

      const skeletonTimer = setTimeout(() => {
        if (token !== renderToken) return;
        v.classList.add('is-loading');
        v.insertAdjacentHTML('afterbegin', UI.skeleton());
      }, 140);

      const pageObj = KR.Pages[page];
      current = { name: page, page: pageObj, hash: location.hash };
      App.syncNav(page, params);
      window.scrollTo(0, 0);

      try {
        await pageObj.render(root, params);
      } catch (err) {
        console.error(err);
        if (token === renderToken) {
          root.innerHTML = '';
          root.appendChild(UI.empty({
            icon: 'triangle-exclamation',
            title: 'This page could not be loaded.',
            text: 'Reload the page. If it keeps happening, export a backup from Backup and restore.',
            actionLabel: 'Try again',
            actionIcon: 'rotate',
            onAction: () => App.render()
          }));
        }
      } finally {
        clearTimeout(skeletonTimer);
        if (token === renderToken) {
          v.classList.remove('is-loading');
          const sk = v.querySelector('.skeleton-page');
          if (sk) sk.remove();
        }
      }

      if (token !== renderToken) return;
      if (focusWasInNav) {
        const title = root.querySelector('.page-title');
        if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
      }
    },

    syncNav(page, params) {
      let active = page;
      if (page === 'invoice-create' && params.id) active = 'invoices';
      U.$$('[data-route]').forEach((a) => {
        if (a.dataset.route === active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      let title = ROUTES[page];
      if (params.id && page === 'invoice-create') title = 'Edit invoice';
      const tbTitle = document.getElementById('tb-title');
      if (tbTitle) tbTitle.textContent = title;
      document.title = `${title} | ${KR.settings.appName}`;
    },

    refreshCurrent() {
      if (current && current.page.refresh) {
        Promise.resolve(current.page.refresh()).catch((e) => console.error(e));
      }
    },

    /* ---------------- Theme ---------------- */
    themePref() {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'system';
    },
    resolvedTheme() {
      const pref = App.themePref();
      if (pref !== 'system') return pref;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    applyTheme() {
      const theme = App.resolvedTheme();
      document.documentElement.dataset.theme = theme;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B111D' : '#F3F5F8');
      const btn = document.getElementById('tb-theme');
      if (btn) {
        btn.innerHTML = UI.icon(theme === 'dark' ? 'sun' : 'moon');
        const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        btn.setAttribute('aria-label', label);
        btn.dataset.tip = label;
      }
    },
    setTheme(pref) {
      if (pref === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, pref);
      App.applyTheme();
      App.refreshCurrent();
    },

    /* ---------------- Branding ---------------- */
    logoSrc() {
      const s = KR.settings;
      return s.logoData || s.logoUrl || DB.DEFAULT_LOGO;
    },
    applyBranding() {
      const s = KR.settings;
      U.$$('[data-brand="app"]').forEach((n) => { n.textContent = s.appName; });
      U.$$('[data-brand="business"]').forEach((n) => { n.textContent = s.businessName; });
      U.$$('[data-brand="initial"]').forEach((n) => { n.textContent = (s.businessName || 'T').trim().charAt(0).toUpperCase(); });
      const src = App.logoSrc();
      U.$$('img[data-brand="logo"]').forEach((img) => {
        const plate = img.closest('.logo-plate');
        img.onerror = () => { if (plate) plate.classList.add('logo-failed'); };
        img.onload = () => { if (plate) plate.classList.remove('logo-failed'); };
        if (img.getAttribute('src') !== src) {
          if (plate) plate.classList.remove('logo-failed');
          img.src = src;
        }
      });
      if (current) App.syncNav(current.name, parseHash().params);
      else document.title = s.appName;
    },
    /** Keep a local copy of a URL logo so invoices and offline use keep working. */
    async cacheLogo() {
      const s = KR.settings;
      if (s.logoData || !s.logoUrl) return;
      try {
        const img = await U.imageToDataURL(s.logoUrl, 512);
        await DB.settings.setMany({ logoData: img.data, logoSource: s.logoSource === 'default' ? 'default' : 'url' });
        KR.settings = await DB.settings.getAll();
      } catch (e) {
        /* The image host may not allow copying; the URL is still used directly. */
      }
    },

    /* ---------------- Drawer (mobile / tablet navigation) ---------------- */
    openDrawer() {
      const sb = document.getElementById('sidebar');
      sb.classList.add('is-open');
      document.getElementById('scrim').hidden = false;
      document.documentElement.classList.add('drawer-open');
      U.$$('[aria-controls="sidebar"]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
      const first = sb.querySelector('.sb-close') || sb.querySelector('a');
      if (first) first.focus({ preventScroll: true });
    },
    closeDrawer() {
      const sb = document.getElementById('sidebar');
      if (!sb || !sb.classList.contains('is-open')) return;
      sb.classList.remove('is-open');
      document.getElementById('scrim').hidden = true;
      document.documentElement.classList.remove('drawer-open');
      U.$$('[aria-controls="sidebar"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    },

    /* ---------------- Tooltips ---------------- */
    tipEl: null,
    tipTimer: null,
    showTip(target) {
      const text = target.dataset.tip;
      if (!text || !document.contains(target)) return;
      if (!App.tipEl) {
        App.tipEl = document.createElement('div');
        App.tipEl.className = 'tooltip';
        App.tipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(App.tipEl);
      }
      const tip = App.tipEl;
      tip.textContent = text;
      tip.hidden = false;
      const r = target.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8;
      const left = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
    },
    hideTip() {
      clearTimeout(App.tipTimer);
      if (App.tipEl) App.tipEl.hidden = true;
    },

    /* ---------------- Auth screens ---------------- */
    showLogin(message) {
      appVisible = false;
      document.getElementById('app').hidden = true;
      const screen = document.getElementById('login-screen');
      screen.hidden = false;
      document.title = `Sign in | ${KR.settings.appName}`;
      const err = document.getElementById('login-error');
      if (message) {
        err.querySelector('span').textContent = message;
        err.hidden = false;
      }
      requestAnimationFrame(() => {
        const email = document.getElementById('login-email');
        if (email && window.matchMedia('(min-width: 768px)').matches) email.focus();
      });
    },

    showApp() {
      document.getElementById('login-screen').hidden = true;
      document.getElementById('login-error').hidden = true;
      document.getElementById('app').hidden = false;
      appVisible = true;
      const session = Auth.session();
      U.$$('[data-session="email"]').forEach((n) => { n.textContent = session ? session.email : ''; });
      if (!/^#\/[a-z-]+/.test(location.hash)) history.replaceState(null, '', '#/invoices');
      App.render();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      KR.PWA.onAppReady();
    },

    async confirmSignOut() {
      const ok = await UI.confirm({
        title: 'Log out?',
        message: 'You will need to sign in again to open your invoices on this device. Your invoices stay saved.',
        confirmText: 'Log out',
        tone: 'primary',
        icon: 'right-from-bracket'
      });
      if (ok) App.signOut();
    },

    signOut(message) {
      if (current && current.page.destroy) {
        try { current.page.destroy(); } catch (e) { /* ignore */ }
      }
      current = null;
      UI.closeAllModals();
      UI.closeMenu();
      App.closeDrawer();
      App.hideTip();
      Auth.logout();
      const v = view();
      v.innerHTML = '';
      history.replaceState(null, '', location.pathname + location.search);
      App.showLogin(message);
    },

    /* ---------------- Shell wiring ---------------- */
    bindShell() {
      // New record buttons (sidebar, topbar, tab bar)
      U.$$('[data-action="new-invoice"]').forEach((b) => b.addEventListener('click', () => { App.closeDrawer(); App.go('invoice-create'); }));
      U.$$('[data-action="logout"]').forEach((b) => b.addEventListener('click', () => { App.closeDrawer(); App.confirmSignOut(); }));
      U.$$('[data-action="install"]').forEach((b) => b.addEventListener('click', () => { App.closeDrawer(); KR.PWA.install(); }));
      U.$$('[aria-controls="sidebar"]').forEach((b) => b.addEventListener('click', () => App.openDrawer()));
      document.querySelector('.sb-close').addEventListener('click', () => App.closeDrawer());
      document.getElementById('scrim').addEventListener('click', () => App.closeDrawer());
      document.getElementById('sidebar').addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) App.closeDrawer(); });
      document.getElementById('sidebar').addEventListener('keydown', (e) => { if (e.key === 'Escape') App.closeDrawer(); });

      document.getElementById('tb-theme').addEventListener('click', () => {
        App.setTheme(App.resolvedTheme() === 'dark' ? 'light' : 'dark');
      });

      document.getElementById('tb-account').addEventListener('click', (e) => {
        UI.menu(e.currentTarget, [
          { label: 'Settings', icon: 'gear', onClick: () => App.go('settings') },
          { label: 'Backup and restore', icon: 'database', onClick: () => App.go('backup') },
          { divider: true },
          { label: 'Log out', icon: 'right-from-bracket', onClick: () => App.confirmSignOut() }
        ]);
      });

      // Router with unsaved-changes guard
      window.addEventListener('hashchange', async () => {
        if (!appVisible) return;
        const target = location.hash;
        if (!bypassGuard && current && current.page.isDirty && current.page.isDirty() && target !== current.hash) {
          history.replaceState(null, '', lastHash || current.hash);
          const ok = await UI.confirm({
            title: 'Leave without saving?',
            message: 'Changes on this page have not been saved.',
            confirmText: 'Leave page',
            icon: 'triangle-exclamation'
          });
          if (!ok) return;
          bypassGuard = true;
          history.replaceState(null, '', target);
          bypassGuard = false;
        }
        App.render();
      });
      window.addEventListener('beforeunload', (e) => {
        if (appVisible && current && current.page.isDirty && current.page.isDirty()) {
          e.preventDefault();
          e.returnValue = '';
        }
      });

      // Data and settings changes
      const onData = U.debounce(() => {
        if (!appVisible) return;
        App.refreshCurrent();
      }, 40);
      U.on('data-changed', onData);
      U.on('settings-changed', () => App.applyBranding());
      U.on('pwa-changed', () => {
        const available = KR.PWA.status() === 'available';
        U.$$('[data-action="install"]').forEach((b) => { b.hidden = !available; });
      });

      // Theme follows the system when set to "system"
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (App.themePref() === 'system') App.applyTheme();
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        if (!appVisible) return;
        const k = e.key.toLowerCase();
        if (e.ctrlKey || e.metaKey || e.altKey || U.isTypingTarget(e.target)) return;
        if (document.documentElement.classList.contains('modal-open')) return;
        if (k === 'n') { e.preventDefault(); App.go('invoice-create'); }
      });

      // Tooltips (mouse hover and keyboard focus)
      document.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const t = e.target.closest('[data-tip]');
        if (!t) return;
        clearTimeout(App.tipTimer);
        App.tipTimer = setTimeout(() => App.showTip(t), 380);
      });
      document.addEventListener('pointerout', (e) => {
        const t = e.target.closest('[data-tip]');
        if (t && !t.contains(e.relatedTarget)) App.hideTip();
      });
      document.addEventListener('focusin', (e) => {
        const t = e.target.closest && e.target.closest('[data-tip]');
        if (t && t.matches(':focus-visible')) App.showTip(t);
      });
      document.addEventListener('focusout', () => App.hideTip());
      document.addEventListener('pointerdown', () => App.hideTip(), true);
      window.addEventListener('scroll', () => App.hideTip(), true);

      // Session expiry when returning to the tab
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && appVisible && !Auth.isLoggedIn()) {
          App.signOut('Your session has ended. Sign in again to continue.');
        }
      });

      // Connectivity notices
      window.addEventListener('offline', () => {
        if (appVisible) UI.toast('Invoices still save on this device. The PDF tool may be unavailable if it was not loaded before.', { type: 'warning', title: 'You are offline' });
      });
      window.addEventListener('online', () => {
        if (appVisible) UI.toast('Connection restored.', { type: 'info' });
      });
    },

    /* ---------------- Boot ---------------- */
    async boot() {
      App.applyTheme();
      try {
        await DB.init();
        KR.settings = await DB.settings.getAll();
      } catch (err) {
        console.error(err);
        const boot = document.getElementById('boot');
        boot.classList.add('boot-failed');
        boot.querySelector('.boot-message').innerHTML =
          '<strong>Storage is not available</strong><span>This browser is blocking the storage the app needs to keep your invoices. Turn off private browsing or allow site data for this site, then reload.</span>';
        return;
      }

      App.applyBranding();
      App.bindShell();
      Auth.bindLoginForm(() => App.showApp());
      KR.PWA.init();

      document.getElementById('boot').hidden = true;
      if (Auth.isLoggedIn()) App.showApp();
      else App.showLogin();

      setTimeout(() => App.cacheLogo(), 2500);
    }
  };

  KR.App = App;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.boot());
  else App.boot();
})(window.KR = window.KR || {});
