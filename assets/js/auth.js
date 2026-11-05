/* ==========================================================================
   THE CURRENT INVESTMENT — auth.js
   Frontend access control for a static app. This keeps casual users out of
   the interface on a shared device; it is not server-grade security.
   ========================================================================== */
(function (KR) {
  'use strict';

  const U = KR.U;
  const SESSION_KEY = 'tci_session';
  const ATTEMPTS_KEY = 'tci_login_attempts';
  // SHA-256 of "email|password" — the password itself is never stored in the app.
  const CREDENTIAL_HASH = '15b8170958d3bed01ed4615ebe62c69e69e83e3cf81437a362ff67f3efc01049';
  const REMEMBER_DAYS = 30;
  const MAX_ATTEMPTS = 5;
  const LOCK_SECONDS = 30;

  const read = (storage) => {
    try {
      const s = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.email || !s.expiresAt) return null;
      if (Date.now() > s.expiresAt) {
        storage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (e) {
      return null;
    }
  };

  const Auth = {
    session() {
      return read(localStorage) || read(sessionStorage);
    },

    isLoggedIn() {
      return !!Auth.session();
    },

    lockRemaining() {
      try {
        const a = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || '{}');
        return a.until && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
      } catch (e) {
        return 0;
      }
    },

    registerFailure() {
      let a;
      try { a = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || '{}'); } catch (e) { a = {}; }
      a.count = (a.count || 0) + 1;
      if (a.count >= MAX_ATTEMPTS) {
        a.until = Date.now() + LOCK_SECONDS * 1000;
        a.count = 0;
      }
      sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
    },

    /** Returns { ok, error } */
    login(email, password, remember) {
      const wait = Auth.lockRemaining();
      if (wait) return { ok: false, error: `Too many attempts. Try again in ${wait} seconds.` };

      const normalized = String(email || '').trim().toLowerCase();
      if (!normalized || !password) return { ok: false, error: 'Enter your email and password.' };

      const valid = U.sha256(`${normalized}|${password}`) === CREDENTIAL_HASH;
      if (!valid) {
        Auth.registerFailure();
        return { ok: false, error: 'Incorrect email or password.' };
      }

      sessionStorage.removeItem(ATTEMPTS_KEY);
      const session = {
        email: normalized,
        token: U.uid(),
        loginAt: Date.now(),
        remember: !!remember,
        expiresAt: Date.now() + (remember ? REMEMBER_DAYS * 864e5 : 12 * 36e5)
      };
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
      return { ok: true };
    },

    logout() {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    },

    /** Wire up the login form in index.html */
    bindLoginForm(onSuccess) {
      const form = document.getElementById('login-form');
      if (!form || form.dataset.bound) return;
      form.dataset.bound = '1';
      const email = form.querySelector('#login-email');
      const pass = form.querySelector('#login-password');
      const remember = form.querySelector('#login-remember');
      const error = form.querySelector('#login-error');
      const toggle = form.querySelector('#toggle-password');
      const submit = form.querySelector('button[type="submit"]');

      toggle.addEventListener('click', () => {
        const show = pass.type === 'password';
        pass.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        toggle.setAttribute('aria-pressed', String(show));
        toggle.innerHTML = KR.UI.icon(show ? 'eye-slash' : 'eye');
        pass.focus();
      });

      [email, pass].forEach((i) => i.addEventListener('input', () => {
        error.hidden = true;
        form.classList.remove('has-login-error');
      }));

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        KR.UI.busy(submit, true, 'Signing in');
        // A short delay makes brute-force typing slower and gives visual feedback.
        setTimeout(() => {
          const result = Auth.login(email.value, pass.value, remember.checked);
          KR.UI.busy(submit, false);
          if (!result.ok) {
            error.querySelector('span').textContent = result.error;
            error.hidden = false;
            form.classList.add('has-login-error');
            pass.select();
            return;
          }
          pass.value = '';
          pass.type = 'password';
          toggle.innerHTML = KR.UI.icon('eye');
          error.hidden = true;
          onSuccess();
        }, 350);
      });
    }
  };

  KR.Auth = Auth;
})(window.KR = window.KR || {});
