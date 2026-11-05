/* ==========================================================================
   THE CURRENT INVESTMENT — pwa.js
   Service worker registration, update notice and the custom install prompt.
   ========================================================================== */
(function (KR) {
  'use strict';

  const U = KR.U;
  const UI = KR.UI;

  const SNOOZE_KEY = 'tci_install_snooze';     // { count, until }
  const INSTALLED_KEY = 'tci_installed';
  const PROMPTED_KEY = 'tci_install_prompted'; // once per browser session
  const SNOOZE_DAYS = [3, 7, 30];
  const PROMPT_DELAY = 8000;

  let deferred = null;
  let modal = null;
  let appReady = false;
  let timer = null;
  let reloading = false;
  let reloadRequested = false;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true;

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const readSnooze = () => {
    try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch (e) { return {}; }
  };

  const PWA = {
    init() {
      if (isStandalone()) localStorage.setItem(INSTALLED_KEY, '1');

      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        // The browser only offers installation when the app is not installed.
        localStorage.removeItem(INSTALLED_KEY);
        U.emit('pwa-changed');
        PWA.schedule();
      });

      window.addEventListener('appinstalled', () => {
        deferred = null;
        localStorage.setItem(INSTALLED_KEY, '1');
        localStorage.removeItem(SNOOZE_KEY);
        if (modal) modal.close('installed');
        U.emit('pwa-changed');
        UI.toast('Open it any time from your home screen or desktop.', { title: 'App installed' });
      });

      PWA.registerServiceWorker();
    },

    status() {
      if (isStandalone()) return 'installed';
      if (deferred) return 'available';
      if (localStorage.getItem(INSTALLED_KEY)) return 'installed';
      if (isIOS()) return 'ios';
      return 'unsupported';
    },

    onAppReady() {
      appReady = true;
      U.emit('pwa-changed');
      PWA.schedule();
    },

    isSnoozed() {
      const s = readSnooze();
      return !!(s.until && s.until > Date.now());
    },

    snooze() {
      const s = readSnooze();
      const count = (s.count || 0) + 1;
      const days = SNOOZE_DAYS[Math.min(count, SNOOZE_DAYS.length) - 1];
      localStorage.setItem(SNOOZE_KEY, JSON.stringify({ count, until: Date.now() + days * 864e5 }));
    },

    /** Offer installation once per session, after the person has had time to use the app. */
    schedule(delay = PROMPT_DELAY) {
      clearTimeout(timer);
      if (!appReady || !deferred || isStandalone()) return;
      if (sessionStorage.getItem(PROMPTED_KEY) || PWA.isSnoozed()) return;
      timer = setTimeout(() => PWA.showPrompt(), delay);
    },

    showPrompt() {
      if (!deferred || modal || !KR.Auth.isLoggedIn() || document.getElementById('app').hidden) return;
      // Never interrupt an open dialog; try again a little later.
      if (document.documentElement.classList.contains('modal-open')) { PWA.schedule(15000); return; }
      sessionStorage.setItem(PROMPTED_KEY, '1');
      const appName = KR.settings.appName || 'THE CURRENT INVESTMENT';
      let choice = null;
      modal = UI.modal({
        title: `Install ${appName}`,
        size: 'sm',
        className: 'modal-install',
        body: `
          <div class="install-prompt">
            <img class="install-app-icon" src="icons/icon-192.png" width="64" height="64" alt="">
            <p>Install this app on your device for faster access and a full-screen experience.</p>
          </div>`,
        footer: `
          <button type="button" class="btn btn-ghost" data-act="later">Not Now</button>
          <button type="button" class="btn btn-primary" data-act="install">${UI.icon('download')}<span>Install App</span></button>`,
        onClose: () => {
          modal = null;
          if (choice !== 'install' && choice !== 'installed') PWA.snooze();
        }
      });
      requestAnimationFrame(() => { if (modal) modal.footer.querySelector('[data-act="install"]').focus({ preventScroll: true }); });
      modal.footer.querySelector('[data-act="later"]').addEventListener('click', () => { choice = 'later'; modal.close(); });
      modal.footer.querySelector('[data-act="install"]').addEventListener('click', () => {
        choice = 'install';
        modal.close();
        PWA.install();
      });
    },

    async install() {
      if (!deferred) {
        if (PWA.status() === 'installed') UI.toast('The app is already installed on this device.', { type: 'info' });
        else if (isIOS()) UI.toast('In Safari, tap the Share button, then choose "Add to Home Screen".', { type: 'info', title: 'Install on iPhone or iPad', duration: 8000 });
        else UI.toast('Open this site in Chrome or Edge over HTTPS to install it.', { type: 'info', title: 'Installation not available' });
        return;
      }
      const prompt = deferred;
      deferred = null;
      clearTimeout(timer);
      try {
        prompt.prompt();
        const result = await prompt.userChoice;
        if (result && result.outcome === 'dismissed') PWA.snooze();
      } catch (e) {
        /* The browser refused to show its dialog. */
      }
      U.emit('pwa-changed');
    },

    registerServiceWorker() {
      if (!('serviceWorker' in navigator)) return;
      const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (!secure) return;

      navigator.serviceWorker.register('service-worker.js').then((reg) => {
        const notify = () => PWA.updateReady(reg);
        if (reg.waiting && navigator.serviceWorker.controller) notify();
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) notify();
          });
        });
        // Look for updates when the app returns to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      }).catch(() => { /* Offline support is optional. */ });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Only reload when the person chose to update (first install also changes the controller).
        if (reloading || !reloadRequested) return;
        reloading = true;
        window.location.reload();
      });
    },

    updateReady(reg) {
      UI.toast('A new version of the app is ready.', {
        type: 'info',
        title: 'Update available',
        duration: 20000,
        action: {
          label: 'Reload',
          onClick: () => {
            reloadRequested = true;
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            else window.location.reload();
          }
        }
      });
    }
  };

  KR.PWA = PWA;
})(window.KR = window.KR || {});
