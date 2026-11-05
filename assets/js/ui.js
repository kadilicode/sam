/* ==========================================================================
   THE CURRENT INVESTMENT — ui.js
   Toasts, modals, confirmations, menus, form helpers, month picker.
   ========================================================================== */
(function (KR) {
  'use strict';

  const U = KR.U;
  const UI = {};
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  UI.icon = (name, extra = '') => `<i class="fa-solid fa-${name} ${extra}" aria-hidden="true"></i>`;

  /* ======================================================================
     Toasts
     ====================================================================== */
  const TOAST_ICONS = { success: 'circle-check', error: 'circle-exclamation', warning: 'triangle-exclamation', info: 'circle-info' };

  UI.toast = (message, opts = {}) => {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const type = opts.type || 'success';
    const el = U.el(`
      <div class="toast toast-${type}" role="${type === 'error' ? 'alert' : 'status'}">
        <span class="toast-icon">${UI.icon(TOAST_ICONS[type] || 'circle-info')}</span>
        <div class="toast-text">
          ${opts.title ? `<strong>${U.esc(opts.title)}</strong>` : ''}
          <span>${U.esc(message)}</span>
        </div>
        ${opts.action ? `<button type="button" class="toast-action">${U.esc(opts.action.label)}</button>` : ''}
        <button type="button" class="toast-close" aria-label="Dismiss">${UI.icon('xmark')}</button>
      </div>`);
    let timer;
    const close = () => {
      clearTimeout(timer);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), reduceMotion() ? 0 : 200);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    if (opts.action) {
      el.querySelector('.toast-action').addEventListener('click', () => {
        close();
        opts.action.onClick();
      });
    }
    root.appendChild(el);
    while (root.children.length > 4) root.firstElementChild.remove();
    const duration = opts.duration || (opts.action ? 6500 : 4000);
    const start = () => { timer = setTimeout(close, duration); };
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start);
    start();
    return { close };
  };

  /* ======================================================================
     Modals
     ====================================================================== */
  const stack = [];
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  const setContent = (target, content) => {
    if (content == null) return;
    if (typeof content === 'string') target.innerHTML = content;
    else {
      target.innerHTML = '';
      target.appendChild(content);
    }
  };

  UI.modal = (opts = {}) => {
    const root = document.getElementById('modal-root');
    const id = 'm-' + U.uid().slice(0, 8);
    const layer = U.el(`
      <div class="modal-layer ${opts.sheet === false ? 'no-sheet' : ''}">
        <div class="modal-backdrop"></div>
        <div class="modal modal-${opts.size || 'md'} ${opts.className || ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
          <header class="modal-head">
            ${opts.back ? `<button type="button" class="icon-btn modal-back" aria-label="Back">${UI.icon('arrow-left')}</button>` : ''}
            <div class="modal-titles">
              <h2 id="${id}" class="modal-title">${U.esc(opts.title || '')}</h2>
              ${opts.subtitle ? `<p class="modal-subtitle">${U.esc(opts.subtitle)}</p>` : ''}
            </div>
            ${opts.dismissible === false ? '' : `<button type="button" class="icon-btn modal-close" aria-label="Close">${UI.icon('xmark')}</button>`}
          </header>
          <div class="modal-body"></div>
          <footer class="modal-foot"></footer>
        </div>
      </div>`);
    const modal = layer.querySelector('.modal');
    const body = layer.querySelector('.modal-body');
    const foot = layer.querySelector('.modal-foot');
    setContent(body, opts.body);
    if (opts.footer) setContent(foot, opts.footer);
    else foot.remove();

    const previousFocus = document.activeElement;
    let closed = false;

    const api = {
      layer,
      modal,
      body,
      get footer() { return layer.querySelector('.modal-foot'); },
      setTitle(t, sub) {
        layer.querySelector('.modal-title').textContent = t;
        const s = layer.querySelector('.modal-subtitle');
        if (s && sub != null) s.textContent = sub;
      },
      setBody: (c) => setContent(body, c),
      setFooter(c) {
        let f = layer.querySelector('.modal-foot');
        if (!c) { if (f) f.remove(); return; }
        if (!f) {
          f = document.createElement('footer');
          f.className = 'modal-foot';
          modal.appendChild(f);
        }
        setContent(f, c);
      },
      setBack(fn) {
        let b = layer.querySelector('.modal-back');
        if (!fn) { if (b) b.remove(); return; }
        if (!b) {
          b = U.el(`<button type="button" class="icon-btn modal-back" aria-label="Back">${UI.icon('arrow-left')}</button>`);
          layer.querySelector('.modal-head').prepend(b);
        }
        b.onclick = fn;
      },
      close(result) {
        if (closed) return;
        closed = true;
        const i = stack.indexOf(api);
        if (i > -1) stack.splice(i, 1);
        layer.classList.add('closing');
        setTimeout(() => {
          layer.remove();
          if (!stack.length) document.documentElement.classList.remove('modal-open');
        }, reduceMotion() ? 0 : 180);
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
          previousFocus.focus({ preventScroll: true });
        }
        if (opts.onClose) opts.onClose(result);
      },
      focusFirst() {
        const target = modal.querySelector('[autofocus]') || body.querySelector(FOCUSABLE) || modal.querySelector(FOCUSABLE);
        if (target) target.focus({ preventScroll: true });
      }
    };

    if (opts.dismissible !== false) {
      layer.querySelector('.modal-backdrop').addEventListener('click', () => api.close());
      layer.querySelector('.modal-close').addEventListener('click', () => api.close());
    }
    if (opts.back) layer.querySelector('.modal-back').addEventListener('click', opts.back);

    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && opts.dismissible !== false && stack[stack.length - 1] === api) {
        e.stopPropagation();
        api.close();
      }
      if (e.key === 'Tab') {
        const items = U.$$(FOCUSABLE, modal).filter((n) => n.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    root.appendChild(layer);
    stack.push(api);
    document.documentElement.classList.add('modal-open');
    requestAnimationFrame(() => api.focusFirst());
    return api;
  };

  UI.closeAllModals = () => stack.slice().forEach((m) => m.close());

  UI.confirm = (opts = {}) =>
    new Promise((resolve) => {
      const tone = opts.tone || 'danger';
      let answered = false;
      const m = UI.modal({
        title: opts.title || 'Are you sure?',
        size: 'sm',
        className: 'modal-confirm',
        body: `
          <div class="confirm-body">
            <span class="confirm-icon tone-${tone}">${UI.icon(opts.icon || (tone === 'danger' ? 'trash-can' : 'circle-question'))}</span>
            <div class="confirm-text">${opts.html || `<p>${U.esc(opts.message || '')}</p>`}</div>
          </div>`,
        footer: `
          <button type="button" class="btn btn-ghost" data-act="cancel">${U.esc(opts.cancelText || 'Cancel')}</button>
          <button type="button" class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" data-act="ok">${U.esc(opts.confirmText || 'Confirm')}</button>`,
        onClose: () => { if (!answered) resolve(false); }
      });
      m.footer.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.footer.querySelector('[data-act="ok"]').addEventListener('click', () => {
        answered = true;
        resolve(true);
        m.close(true);
      });
      requestAnimationFrame(() => m.footer.querySelector('[data-act="cancel"]').focus());
    });

  /* ======================================================================
     Popover menu
     ====================================================================== */
  let openMenu = null;
  UI.closeMenu = () => {
    if (openMenu) {
      openMenu.el.remove();
      openMenu.anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', openMenu.outside, true);
      window.removeEventListener('resize', UI.closeMenu);
      window.removeEventListener('scroll', openMenu.onScroll, true);
      openMenu = null;
    }
  };

  UI.menu = (anchor, items) => {
    if (openMenu && openMenu.anchor === anchor) { UI.closeMenu(); return; }
    UI.closeMenu();
    const el = U.el(`<div class="popover-menu" role="menu"></div>`);
    items.filter(Boolean).forEach((it) => {
      if (it.divider) { el.appendChild(U.el('<div class="menu-divider" role="separator"></div>')); return; }
      const b = U.el(`<button type="button" role="menuitem" class="menu-item ${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>
        ${it.icon ? UI.icon(it.icon) : ''}<span>${U.esc(it.label)}</span></button>`);
      b.addEventListener('click', () => { UI.closeMenu(); it.onClick(); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    anchor.setAttribute('aria-expanded', 'true');

    const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) UI.closeMenu(); };
    const onScroll = (e) => { if (!el.contains(e.target)) UI.closeMenu(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', UI.closeMenu);
    window.addEventListener('scroll', onScroll, true);
    el.addEventListener('keydown', (e) => {
      const btns = U.$$('.menu-item:not([disabled])', el);
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      if (e.key === 'Escape') { UI.closeMenu(); anchor.focus(); }
      if (e.key === 'Tab') UI.closeMenu();
    });
    openMenu = { el, anchor, outside, onScroll };
    const first = el.querySelector('.menu-item:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  };

  /* ======================================================================
     Form helpers
     ====================================================================== */
  UI.bindAmount = (input) => {
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => {
      const decimals = U.decimals();
      const raw = input.value;
      const caret = input.selectionStart == null ? raw.length : input.selectionStart;
      const sigBefore = raw.slice(0, caret).replace(/[^\d.]/g, '').length;
      let clean = raw.replace(/[^\d.]/g, '');
      const dot = clean.indexOf('.');
      let intPart = dot === -1 ? clean : clean.slice(0, dot);
      let decPart = dot === -1 ? null : clean.slice(dot + 1).replace(/\./g, '');
      intPart = intPart.replace(/^0+(?=\d)/, '');
      if (intPart.length > 13) intPart = intPart.slice(0, 13);
      if (!decimals) decPart = null;
      else if (decPart != null) decPart = decPart.slice(0, decimals);
      const out = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decPart != null ? '.' + decPart : '');
      input.value = out;
      let count = 0;
      let pos = 0;
      while (pos < out.length && count < sigBefore) {
        if (/[\d.]/.test(out[pos])) count++;
        pos++;
      }
      try { input.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
    });
  };

  UI.fieldError = (control, message) => {
    const field = control.closest('.field') || control.parentElement;
    field.classList.add('has-error');
    control.setAttribute('aria-invalid', 'true');
    let err = field.querySelector('.field-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'field-error';
      err.id = 'err-' + U.uid().slice(0, 8);
      field.appendChild(err);
    }
    err.innerHTML = `${UI.icon('circle-exclamation')} ${U.esc(message)}`;
    control.setAttribute('aria-describedby', err.id);
  };

  UI.clearFieldError = (control) => {
    const field = control.closest('.field') || control.parentElement;
    field.classList.remove('has-error');
    control.removeAttribute('aria-invalid');
    const err = field.querySelector('.field-error');
    if (err) err.remove();
  };

  UI.clearFieldErrors = (root) => {
    U.$$('.has-error', root).forEach((f) => f.classList.remove('has-error'));
    U.$$('.field-error', root).forEach((e) => e.remove());
    U.$$('[aria-invalid]', root).forEach((c) => c.removeAttribute('aria-invalid'));
  };

  /** Clear an error as soon as the user edits the control. */
  UI.autoClearErrors = (root) => {
    root.addEventListener('input', (e) => { if (e.target.matches('input,textarea,select')) UI.clearFieldError(e.target); });
    root.addEventListener('change', (e) => {
      if (e.target.matches('input[type="radio"]')) {
        const group = e.target.closest('.field');
        if (group) { group.classList.remove('has-error'); const er = group.querySelector('.field-error'); if (er) er.remove(); }
      }
    });
  };

  UI.busy = (btn, isBusy, label) => {
    if (!btn) return;
    if (isBusy) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${U.esc(label || 'Working')}</span>`;
    } else {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  };

  UI.options = (list, selected, placeholder) =>
    (placeholder ? `<option value="">${U.esc(placeholder)}</option>` : '') +
    list.map((o) => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : o.label;
      return `<option value="${U.esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${U.esc(l)}</option>`;
    }).join('');

  /** Radio chip group markup. */
  UI.chips = (name, list, selected) =>
    `<div class="chip-group" role="radiogroup">${list
      .map((v, i) => {
        const id = `${name}-${i}-${U.uid().slice(0, 4)}`;
        return `<input type="radio" class="chip-input" name="${name}" id="${id}" value="${U.esc(v)}" ${v === selected ? 'checked' : ''}>
                <label class="chip" for="${id}">${U.esc(v)}</label>`;
      })
      .join('')}</div>`;

  /* ======================================================================
     Segmented control
     ====================================================================== */
  UI.segmented = (options, value, onChange, opts = {}) => {
    const el = U.el(`<div class="segmented ${opts.className || ''}" role="group" aria-label="${U.esc(opts.label || 'Options')}"></div>`);
    options.forEach((o) => {
      const b = U.el(`<button type="button" class="seg-btn" data-value="${U.esc(o.value)}" aria-pressed="${o.value === value}">
        ${o.icon ? UI.icon(o.icon) : ''}<span>${U.esc(o.label)}</span></button>`);
      b.addEventListener('click', () => {
        U.$$('.seg-btn', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onChange(o.value);
      });
      el.appendChild(b);
    });
    return el;
  };

  /* ======================================================================
     Empty state & skeleton
     ====================================================================== */
  UI.empty = (o) => {
    const el = U.el(`
      <div class="empty-state ${o.compact ? 'compact' : ''}">
        <span class="empty-icon">${UI.icon(o.icon || 'folder-open')}</span>
        <h3>${U.esc(o.title)}</h3>
        ${o.text ? `<p>${U.esc(o.text)}</p>` : ''}
        ${o.actionLabel ? `<button type="button" class="btn btn-primary">${UI.icon(o.actionIcon || 'plus')}<span>${U.esc(o.actionLabel)}</span></button>` : ''}
      </div>`);
    if (o.actionLabel) el.querySelector('button').addEventListener('click', o.onAction);
    return el;
  };

  UI.skeleton = () => `
    <div class="skeleton-page" aria-busy="true" aria-label="Loading">
      <div class="sk sk-title"></div>
      <div class="sk sk-hero"></div>
      <div class="sk-row"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>
      <div class="sk sk-block"></div>
    </div>`;

  /* ======================================================================
     Month picker: [<] [September 2026 v] [>] [This month]
     ====================================================================== */
  UI.monthPicker = ({ value, onChange }) => {
    let current = value;
    const el = U.el(`
      <div class="month-picker">
        <button type="button" class="icon-btn mp-prev" aria-label="Previous month" data-tip="Previous month">${UI.icon('chevron-left')}</button>
        <button type="button" class="mp-label" aria-haspopup="dialog" aria-expanded="false">
          ${UI.icon('calendar')}<span></span>
        </button>
        <button type="button" class="icon-btn mp-next" aria-label="Next month" data-tip="Next month">${UI.icon('chevron-right')}</button>
        <button type="button" class="btn btn-ghost btn-sm mp-today">This month</button>
      </div>`);
    const labelBtn = el.querySelector('.mp-label');

    const sync = () => {
      labelBtn.querySelector('span').textContent = U.monthLabel(current);
      el.querySelector('.mp-today').hidden = current === U.currentMonthKey();
    };
    const set = (k) => {
      current = k;
      sync();
      onChange(k);
    };
    el.querySelector('.mp-prev').addEventListener('click', () => set(U.addMonths(current, -1)));
    el.querySelector('.mp-next').addEventListener('click', () => set(U.addMonths(current, 1)));
    el.querySelector('.mp-today').addEventListener('click', () => set(U.currentMonthKey()));

    let pop = null;
    const closePop = () => {
      if (!pop) return;
      pop.remove();
      pop = null;
      labelBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e) => { if (pop && !pop.contains(e.target) && !labelBtn.contains(e.target)) closePop(); };

    labelBtn.addEventListener('click', () => {
      if (pop) { closePop(); return; }
      let year = Number(current.slice(0, 4));
      pop = U.el(`
        <div class="mp-pop" role="dialog" aria-label="Choose month">
          <div class="mp-pop-head">
            <button type="button" class="icon-btn" data-y="-1" aria-label="Previous year">${UI.icon('chevron-left')}</button>
            <strong class="mp-year"></strong>
            <button type="button" class="icon-btn" data-y="1" aria-label="Next year">${UI.icon('chevron-right')}</button>
          </div>
          <div class="mp-grid"></div>
        </div>`);
      const renderGrid = () => {
        pop.querySelector('.mp-year').textContent = year;
        const grid = pop.querySelector('.mp-grid');
        grid.innerHTML = U.MONTHS_SHORT.map((m, i) => {
          const k = `${year}-${String(i + 1).padStart(2, '0')}`;
          return `<button type="button" class="mp-month ${k === current ? 'active' : ''} ${k === U.currentMonthKey() ? 'is-now' : ''}" data-k="${k}">${m}</button>`;
        }).join('');
      };
      renderGrid();
      pop.addEventListener('click', (e) => {
        const yb = e.target.closest('[data-y]');
        if (yb) { year += Number(yb.dataset.y); renderGrid(); return; }
        const mb = e.target.closest('[data-k]');
        if (mb) { closePop(); set(mb.dataset.k); labelBtn.focus(); }
      });
      pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); labelBtn.focus(); } });
      el.appendChild(pop);
      labelBtn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
      const active = pop.querySelector('.mp-month.active') || pop.querySelector('.mp-month');
      active.focus();
    });

    sync();
    el.setValue = (k) => { current = k; sync(); };
    return el;
  };

  /* ======================================================================
     Misc
     ====================================================================== */
  UI.typeBadge = (type) =>
    type === 'income'
      ? `<span class="badge badge-income">${UI.icon('arrow-down')}Income</span>`
      : `<span class="badge badge-expense">${UI.icon('arrow-up')}Expense</span>`;

  UI.demoBadge = () => `<span class="badge badge-demo" data-tip="Demo record">Demo</span>`;

  UI.pageHeader = ({ title, subtitle, actions }) => {
    const el = U.el(`
      <div class="page-header">
        <div class="page-heading">
          <h1 class="page-title">${U.esc(title)}</h1>
          ${subtitle ? `<p class="page-subtitle">${U.esc(subtitle)}</p>` : ''}
        </div>
        <div class="page-actions"></div>
      </div>`);
    if (actions) {
      const box = el.querySelector('.page-actions');
      (Array.isArray(actions) ? actions : [actions]).forEach((a) => box.appendChild(typeof a === 'string' ? U.el(a) : a));
    }
    return el;
  };

  KR.UI = UI;
})(window.KR = window.KR || {});
