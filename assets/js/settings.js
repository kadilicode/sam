/* ==========================================================================
   THE CURRENT INVESTMENT — settings.js
   Business details for invoices, appearance, backup & restore.
   ========================================================================== */
(function (KR) {
  'use strict';

  const U = KR.U;
  const UI = KR.UI;
  const DB = KR.DB;

  const BACKUP_FORMAT = 'the-current-investment-invoices-backup';
  const BACKUP_VERSION = 1;
  const CURRENCIES = ['TZS', 'KES', 'UGX', 'RWF', 'BIF', 'USD', 'EUR', 'GBP', 'ZAR'];

  const reloadAll = async () => {
    KR.Invoices.invalidate();
    KR.settings = await DB.settings.getAll();
    KR.App.applyBranding();
    U.emit('data-changed', { entity: 'all' });
  };

  /* ======================================================================
     Backup helpers
     ====================================================================== */
  const Backup = {
    async build() {
      const data = await DB.exportAll();
      data.settings = data.settings.filter((s) => !s.key.startsWith('_'));
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        app: KR.settings.appName,
        business: KR.settings.businessName,
        exportedAt: new Date().toISOString(),
        counts: {
          invoices: data.invoices.length,
          invoiceItems: data.invoiceItems.length,
          settings: data.settings.length
        },
        data
      };
    },

    async download(silent) {
      const backup = await Backup.build();
      const stamp = backup.exportedAt.slice(0, 16).replace(/[T:]/g, '-');
      U.download(`current-investment-invoices-backup-${stamp}.json`, JSON.stringify(backup, null, 2), 'application/json');
      localStorage.setItem('tci_last_backup', backup.exportedAt);
      if (!silent) UI.toast(`${backup.counts.invoices} invoices and your settings were saved to a backup file.`, { title: 'Backup exported' });
      return backup;
    },

    /** Validate and sanitize a parsed backup. */
    validate(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'The file does not contain backup data.' };
      if (obj.format !== BACKUP_FORMAT) return { ok: false, error: 'This file is not a THE CURRENT INVESTMENT invoices backup.' };
      if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) return { ok: false, error: 'This backup was made by a newer version of the app and cannot be restored here.' };
      const d = obj.data;
      if (!d || typeof d !== 'object') return { ok: false, error: 'The backup is missing its data section.' };
      for (const key of ['invoices', 'invoiceItems', 'settings']) {
        if (!Array.isArray(d[key])) return { ok: false, error: `The backup is damaged: "${key}" is missing.` };
      }
      const exportedAt = new Date(obj.exportedAt);
      if (isNaN(exportedAt)) return { ok: false, error: 'The backup date is not valid.' };

      const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
      const num = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN);
      const skipped = { invoices: 0, invoiceItems: 0 };

      const invoices = [];
      const statusValues = KR.Invoices.STATUSES.map((s) => s.value);
      d.invoices.forEach((i) => {
        if (!i || !str(i.id) || !str(i.number) || !U.isValidISO(i.date) || !i.customer || !str(i.customer.name)) { skipped.invoices++; return; }
        invoices.push({
          id: str(i.id, 100), number: str(i.number, 60), date: i.date, dueDate: U.isValidISO(i.dueDate) ? i.dueDate : i.date,
          customer: { name: str(i.customer.name, 120), phone: str(i.customer.phone, 40), email: str(i.customer.email, 120), address: str(i.customer.address, 300) },
          discountType: i.discountType === 'percent' ? 'percent' : 'amount', discountValue: num(i.discountValue) || 0, taxRate: num(i.taxRate) || 0,
          notes: str(i.notes, 1000), paymentInstructions: str(i.paymentInstructions, 1000),
          status: statusValues.includes(i.status) ? i.status : 'unpaid', statusAuto: !!i.statusAuto,
          subtotal: num(i.subtotal) || 0, discountAmount: num(i.discountAmount) || 0, taxAmount: num(i.taxAmount) || 0, total: num(i.total) || 0,
          isDemo: !!i.isDemo, createdAt: num(i.createdAt) || Date.now(), updatedAt: num(i.updatedAt) || Date.now()
        });
      });
      const invIds = new Set(invoices.map((i) => i.id));

      const invoiceItems = [];
      d.invoiceItems.forEach((it) => {
        if (!it || !str(it.id) || !invIds.has(it.invoiceId) || !str(it.item) || !(num(it.qty) > 0) || !(num(it.unitPrice) >= 0)) { skipped.invoiceItems++; return; }
        invoiceItems.push({ id: str(it.id, 100), invoiceId: it.invoiceId, position: num(it.position) || 0, item: str(it.item, 120), description: str(it.description, 300), qty: it.qty, unitPrice: U.round(it.unitPrice) });
      });

      const settings = d.settings
        .filter((s) => s && typeof s.key === 'string' && s.key in DB.DEFAULT_SETTINGS)
        .map((s) => ({ key: s.key, value: s.value }));

      const totalSkipped = Object.values(skipped).reduce((a, b) => a + b, 0);
      return {
        ok: true,
        info: { exportedAt, app: str(obj.app, 80), business: str(obj.business, 80), skipped, totalSkipped },
        data: { invoices, invoiceItems, settings }
      };
    },

    async importFile(file) {
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) { UI.toast('Backup files larger than 50 MB are not supported.', { type: 'error', title: 'File too large' }); return; }
      let parsed;
      try {
        parsed = JSON.parse(await U.readFileText(file));
      } catch (e) {
        UI.toast('The file could not be read as JSON. Choose a backup exported from this app.', { type: 'error', title: 'Invalid backup' });
        return;
      }
      const res = Backup.validate(parsed);
      if (!res.ok) { UI.toast(res.error, { type: 'error', title: 'Backup not restored' }); return; }
      const { info, data } = res;
      const current = await DB.exportAll();

      const m = UI.modal({
        title: 'Restore backup',
        subtitle: file.name,
        size: 'md',
        body: `
          <div class="stack">
            <div class="restore-meta">
              <div><span>Backup created</span><strong>${U.esc(U.fmtDateTime(info.exportedAt.getTime()))}</strong></div>
              ${info.business ? `<div><span>Business</span><strong>${U.esc(info.business)}</strong></div>` : ''}
            </div>
            <table class="data-table compare-table">
              <thead><tr><th scope="col">Records</th><th scope="col" class="num">In backup</th><th scope="col" class="num">On this device</th></tr></thead>
              <tbody>
                <tr><td>Invoices</td><td class="num">${data.invoices.length}</td><td class="num">${current.invoices.length}</td></tr>
                <tr><td>Invoice items</td><td class="num">${data.invoiceItems.length}</td><td class="num">${current.invoiceItems.length}</td></tr>
              </tbody>
            </table>
            ${info.totalSkipped ? `<p class="notice notice-warning">${UI.icon('triangle-exclamation')}<span>${info.totalSkipped} damaged ${info.totalSkipped === 1 ? 'record' : 'records'} will be skipped.</span></p>` : ''}
            <fieldset class="field">
              <legend class="label">How to restore</legend>
              <div class="option-cards">
                <label class="option-card"><input type="radio" name="mode" value="replace" checked>
                  <span class="oc-icon">${UI.icon('arrows-rotate')}</span><span class="oc-text"><strong>Replace all data</strong><span>This device will match the backup exactly, including settings.</span></span></label>
                <label class="option-card"><input type="radio" name="mode" value="merge">
                  <span class="oc-icon">${UI.icon('code-merge')}</span><span class="oc-text"><strong>Merge</strong><span>Add records that are not already on this device. Settings are kept.</span></span></label>
              </div>
            </fieldset>
            <label class="check"><input type="checkbox" name="safety" checked><span>Download a backup of the current data first</span></label>
          </div>`,
        footer: `<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
                 <button type="button" class="btn btn-primary" data-act="restore">${UI.icon('upload')}<span>Restore backup</span></button>`
      });
      m.footer.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.footer.querySelector('[data-act="restore"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const mode = m.body.querySelector('input[name="mode"]:checked').value;
        const safety = m.body.querySelector('input[name="safety"]').checked;
        if (mode === 'replace') {
          const ok = await UI.confirm({
            title: 'Replace all data?',
            message: `All ${current.invoices.length} invoices on this device will be replaced by the backup.`,
            confirmText: 'Replace data',
            icon: 'arrows-rotate'
          });
          if (!ok) return;
        }
        UI.busy(btn, true, 'Restoring');
        try {
          if (safety) await Backup.download(true);
          let added = 0;
          if (mode === 'replace') {
            const settingsKeys = new Set(data.settings.map((s) => s.key));
            const settings = [
              ...data.settings,
              ...Object.keys(DB.DEFAULT_SETTINGS).filter((k) => !settingsKeys.has(k)).map((key) => ({ key, value: DB.DEFAULT_SETTINGS[key] }))
            ];
            await DB.replaceAll({ ...data, settings });
          } else {
            added = await DB.mergeAll(data);
          }
          await reloadAll();
          m.close();
          KR.App.go('invoices');
          UI.toast(mode === 'replace'
            ? `${data.invoices.length} invoices restored.`
            : `${added} new ${added === 1 ? 'record was' : 'records were'} added from the backup.`,
          { title: 'Backup restored' });
        } catch (err) {
          UI.busy(btn, false);
          UI.toast('Nothing was changed. The restore could not be completed.', { type: 'error', title: 'Restore failed' });
        }
      });
    }
  };

  /* ======================================================================
     Settings page
     ====================================================================== */
  const SettingsPage = {
    async render(root) {
      this.root = root;
      const s = { ...KR.settings };
      this.pendingLogo = { data: s.logoData, source: s.logoSource };
      const uid = U.uid().slice(0, 6);

      root.appendChild(UI.pageHeader({ title: 'Settings', subtitle: 'Your details used on every invoice. Change them at any time.' }));

      const el = U.el(`
        <div class="settings-layout">
          <nav class="settings-nav" aria-label="Settings sections">
            <a href="#set-business">${UI.icon('building')}<span>Business profile</span></a>
            <a href="#set-invoices">${UI.icon('file-invoice')}<span>Invoices and currency</span></a>
            <a href="#set-payment">${UI.icon('building-columns')}<span>Payment details</span></a>
            <a href="#set-appearance">${UI.icon('circle-half-stroke')}<span>Appearance</span></a>
            <a href="#set-app">${UI.icon('mobile-screen')}<span>App and security</span></a>
            <a href="#/backup" class="nav-external">${UI.icon('database')}<span>Backup and restore</span></a>
          </nav>

          <div class="settings-main">
            <form class="settings-form stack-lg" novalidate>
              <section class="panel" id="set-business">
                <div class="panel-head"><div><h2 class="panel-title">Business profile</h2><p class="panel-sub">Shown on the invoice header, footer and PDF.</p></div></div>
                <div class="logo-row">
                  <div class="logo-plate logo-preview"><img alt="Business logo preview"></div>
                  <div class="logo-controls">
                    <div class="btn-row">
                      <label class="btn btn-ghost file-btn">${UI.icon('upload')}<span>Upload logo</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="sr-only logo-file"></label>
                      <button type="button" class="btn btn-ghost reset-logo">${UI.icon('rotate-left')}<span>Use default logo</span></button>
                    </div>
                    <p class="field-hint">PNG, JPG, WEBP or SVG up to 3 MB. A transparent logo on a light background works best.</p>
                    <label class="check"><input type="checkbox" name="watermark" ${s.watermark !== false ? 'checked' : ''}><span>Show the logo as a faint watermark behind the invoice</span></label>
                  </div>
                </div>
                <div class="form-grid">
                  <div class="field"><label for="s-bn-${uid}">Business name</label><input id="s-bn-${uid}" class="input" name="businessName" value="${U.esc(s.businessName)}" maxlength="80"></div>
                  <div class="field"><label for="s-tg-${uid}">Tagline <span class="optional">Optional</span></label><input id="s-tg-${uid}" class="input" name="businessTagline" value="${U.esc(s.businessTagline)}" maxlength="80" placeholder="e.g. Electrical Solution"></div>
                  <div class="field"><label for="s-ph-${uid}">Business phone</label><input id="s-ph-${uid}" type="tel" inputmode="tel" class="input" name="businessPhone" value="${U.esc(s.businessPhone)}" placeholder="e.g. +255 7XX XXX XXX"></div>
                  <div class="field"><label for="s-em-${uid}">Business email</label><input id="s-em-${uid}" type="email" inputmode="email" class="input" name="businessEmail" value="${U.esc(s.businessEmail)}"></div>
                  <div class="field"><label for="s-ad-${uid}">Business address</label><textarea id="s-ad-${uid}" class="input" name="businessAddress" rows="2">${U.esc(s.businessAddress)}</textarea></div>
                  <div class="field"><label for="s-tin-${uid}">TIN</label><input id="s-tin-${uid}" class="input" name="tin" value="${U.esc(s.tin)}" inputmode="numeric" placeholder="Taxpayer identification number"></div>
                  <div class="field span-2"><label for="s-lu-${uid}">Logo URL <span class="optional">Used when no logo is uploaded</span></label><input id="s-lu-${uid}" type="url" class="input" name="logoUrl" value="${U.esc(s.logoUrl)}"></div>
                </div>
              </section>

              <section class="panel" id="set-invoices">
                <div class="panel-head"><div><h2 class="panel-title">Invoices and currency</h2><p class="panel-sub">Defaults for new invoices.</p></div></div>
                <div class="form-grid">
                  <div class="field"><label for="s-pre-${uid}">Invoice prefix</label><input id="s-pre-${uid}" class="input" name="invoicePrefix" value="${U.esc(s.invoicePrefix)}" maxlength="20" autocapitalize="characters">
                    <p class="field-hint prefix-example"></p></div>
                  <div class="field"><label for="s-cur-${uid}">Currency</label><select id="s-cur-${uid}" class="input" name="currency">${UI.options([...new Set([...CURRENCIES, s.currency])], s.currency)}</select>
                    <p class="field-hint">Changes the label only. Saved amounts are not converted.</p></div>
                  <div class="field"><label for="s-due-${uid}">Default payment terms (days)</label><input id="s-due-${uid}" type="number" min="0" max="365" inputmode="numeric" class="input" name="defaultDueDays" value="${U.esc(s.defaultDueDays)}"></div>
                  <div class="field"><label for="s-tl-${uid}">Tax name</label><input id="s-tl-${uid}" class="input" name="taxLabel" value="${U.esc(s.taxLabel)}" maxlength="20" placeholder="VAT"></div>
                  <div class="field"><label for="s-tax-${uid}">Default tax rate (%)</label><input id="s-tax-${uid}" type="number" min="0" max="100" step="any" inputmode="decimal" class="input" name="defaultTaxRate" value="${U.esc(s.defaultTaxRate)}"></div>
                  <div class="field span-2"><label for="s-ty-${uid}">Thank-you message</label><input id="s-ty-${uid}" class="input" name="invoiceThankYou" value="${U.esc(s.invoiceThankYou)}" maxlength="120"></div>
                </div>
              </section>

              <section class="panel" id="set-payment">
                <div class="panel-head"><div><h2 class="panel-title">Payment details</h2><p class="panel-sub">Filled into the payment section of new invoices.</p></div></div>
                <div class="form-grid">
                  <div class="field"><label for="s-bank-${uid}">Bank name</label><input id="s-bank-${uid}" class="input" name="bankName" value="${U.esc(s.bankName)}"></div>
                  <div class="field"><label for="s-acn-${uid}">Account name</label><input id="s-acn-${uid}" class="input" name="accountName" value="${U.esc(s.accountName)}"></div>
                  <div class="field"><label for="s-acc-${uid}">Account number</label><input id="s-acc-${uid}" class="input" name="accountNumber" value="${U.esc(s.accountNumber)}" inputmode="numeric"></div>
                  <div class="field"><label for="s-mm-${uid}">Mobile money number</label><input id="s-mm-${uid}" type="tel" inputmode="tel" class="input" name="mobileMoneyNumber" value="${U.esc(s.mobileMoneyNumber)}"></div>
                  <div class="field span-2"><label for="s-pi-${uid}">Payment instructions</label><textarea id="s-pi-${uid}" class="input" name="paymentInstructions" rows="3" placeholder="e.g. Pay within 14 days and use the invoice number as the reference.">${U.esc(s.paymentInstructions)}</textarea></div>
                </div>
              </section>

              <div class="save-bar">
                <span class="save-state" aria-live="polite"></span>
                <button type="submit" class="btn btn-primary btn-lg">${UI.icon('floppy-disk')}<span>Save settings</span></button>
              </div>
            </form>

            <section class="panel" id="set-appearance">
              <div class="panel-head"><div><h2 class="panel-title">Appearance</h2><p class="panel-sub">Your choice is remembered on this device.</p></div></div>
              <div class="theme-toggle"></div>
            </section>

            <section class="panel" id="set-app">
              <div class="panel-head"><div><h2 class="panel-title">App and security</h2></div></div>
              <div class="install-box"></div>
              <div class="notice notice-info security-note">
                ${UI.icon('shield-halved')}
                <div>
                  <strong>How your data is stored</strong>
                  <p>Invoices and settings are saved in this browser on this device, not on a server. The sign-in screen keeps casual users out, but anyone with full access to this device's browser data could read them. Export a backup regularly and keep it somewhere safe.</p>
                </div>
              </div>
            </section>
          </div>
        </div>`);
      root.appendChild(el);
      this.el = el;

      /* Smooth in-page section nav (keeps hash routing intact) */
      el.querySelector('.settings-nav').addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a || a.classList.contains('nav-external')) return;
        e.preventDefault();
        const target = el.querySelector(a.getAttribute('href'));
        if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
      });

      /* Logo */
      const form = el.querySelector('.settings-form');
      const preview = el.querySelector('.logo-preview img');
      const syncLogo = () => {
        preview.src = this.pendingLogo.data || form.querySelector('[name="logoUrl"]').value || DB.DEFAULT_LOGO;
      };
      syncLogo();
      form.querySelector('[name="logoUrl"]').addEventListener('change', () => { if (this.pendingLogo.source !== 'upload') this.pendingLogo = { data: '', source: 'url' }; syncLogo(); });
      el.querySelector('.logo-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!/^image\//.test(file.type)) { UI.toast('Choose an image file.', { type: 'error' }); return; }
        if (file.size > 3 * 1024 * 1024) { UI.toast('The logo must be 3 MB or smaller.', { type: 'error' }); return; }
        try {
          const raw = await U.fileToDataURL(file);
          const img = await U.imageToDataURL(raw, 512);
          this.pendingLogo = { data: img.data, source: 'upload' };
          syncLogo();
          this.markDirty();
        } catch (err) {
          UI.toast('That image could not be used as a logo.', { type: 'error' });
        }
      });
      el.querySelector('.reset-logo').addEventListener('click', () => {
        this.pendingLogo = { data: '', source: 'default' };
        form.querySelector('[name="logoUrl"]').value = DB.DEFAULT_LOGO;
        syncLogo();
        this.markDirty();
      });

      const prefix = form.querySelector('[name="invoicePrefix"]');
      const syncPrefix = () => { el.querySelector('.prefix-example').textContent = `Next numbers look like ${(prefix.value.trim() || 'TCI-INV').toUpperCase()}-${U.todayISO().slice(0, 4)}-0001`; };
      prefix.addEventListener('input', syncPrefix);
      syncPrefix();

      UI.autoClearErrors(form);
      form.addEventListener('input', () => this.markDirty());
      form.addEventListener('change', () => this.markDirty());
      form.addEventListener('submit', (e) => { e.preventDefault(); this.save(form); });

      /* Theme */
      el.querySelector('.theme-toggle').appendChild(UI.segmented(
        [{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'system', label: 'System', icon: 'desktop' }],
        KR.App.themePref(),
        (v) => KR.App.setTheme(v),
        { label: 'Theme' }
      ));

      this.renderInstall();
      this.offPwa = U.on('pwa-changed', () => this.renderInstall());
    },

    markDirty() {
      if (!this.el) return;
      this.el.querySelector('.save-state').textContent = 'Unsaved changes';
      this.dirty = true;
    },

    async save(form) {
      const val = (n) => form.querySelector(`[name="${n}"]`).value.trim();
      UI.clearFieldErrors(form);
      const errs = [];
      const err = (n, m) => { const c = form.querySelector(`[name="${n}"]`); UI.fieldError(c, m); errs.push(c); };
      if (!val('businessName')) err('businessName', 'Enter the business name.');
      if (val('businessEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('businessEmail'))) err('businessEmail', 'Enter a valid email address.');
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(val('invoicePrefix'))) err('invoicePrefix', 'Use letters, numbers and hyphens only.');
      const due = Number(val('defaultDueDays'));
      if (!(Number.isInteger(due) && due >= 0 && due <= 365)) err('defaultDueDays', 'Enter a whole number from 0 to 365.');
      const tax = Number(val('defaultTaxRate'));
      if (val('defaultTaxRate') === '' || !(tax >= 0 && tax <= 100)) err('defaultTaxRate', 'Enter a rate from 0 to 100.');
      if (val('logoUrl') && val('logoUrl') !== DB.DEFAULT_LOGO && !/^https?:\/\//i.test(val('logoUrl'))) err('logoUrl', 'Enter a full link starting with https://');
      if (errs.length) { errs[0].focus(); errs[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

      const updates = {
        businessName: val('businessName'),
        appName: val('businessName'),
        businessTagline: val('businessTagline'),
        watermark: form.querySelector('[name="watermark"]').checked,
        taxLabel: val('taxLabel') || 'VAT',
        businessPhone: val('businessPhone'),
        businessEmail: val('businessEmail'),
        businessAddress: val('businessAddress'),
        tin: val('tin'),
        logoUrl: val('logoUrl'),
        logoData: this.pendingLogo.data || '',
        logoSource: this.pendingLogo.source || 'url',
        invoicePrefix: val('invoicePrefix').toUpperCase(),
        currency: val('currency'),
        defaultDueDays: due,
        defaultTaxRate: tax,
        invoiceThankYou: val('invoiceThankYou'),
        bankName: val('bankName'),
        accountName: val('accountName'),
        accountNumber: val('accountNumber'),
        mobileMoneyNumber: val('mobileMoneyNumber'),
        paymentInstructions: val('paymentInstructions')
      };
      const btn = form.querySelector('button[type="submit"]');
      UI.busy(btn, true, 'Saving');
      try {
        await DB.settings.setMany(updates);
        KR.settings = await DB.settings.getAll();
        KR.App.applyBranding();
        if (!updates.logoData) KR.App.cacheLogo();
        U.emit('settings-changed');
        this.dirty = false;
        this.el.querySelector('.save-state').textContent = 'All changes saved';
        UI.toast('New invoices, previews and PDFs will use these details.', { title: 'Settings saved' });
      } catch (e) {
        UI.toast('Settings could not be saved.', { type: 'error' });
      } finally {
        UI.busy(btn, false);
      }
    },

    renderInstall() {
      if (!this.el) return;
      const box = this.el.querySelector('.install-box');
      const st = KR.PWA.status();
      if (st === 'installed') {
        box.innerHTML = `<div class="install-row"><span class="install-ic is-income">${UI.icon('circle-check')}</span><div><strong>App installed</strong><p>You are using the installed version of the app.</p></div></div>`;
      } else if (st === 'available') {
        box.innerHTML = `<div class="install-row"><span class="install-ic">${UI.icon('download')}</span><div><strong>Install on this device</strong><p>Open the app from your home screen or desktop in a full-screen window.</p></div>
          <button type="button" class="btn btn-primary install-now">${UI.icon('download')}<span>Install app</span></button></div>`;
        box.querySelector('.install-now').addEventListener('click', () => KR.PWA.install());
      } else if (st === 'ios') {
        box.innerHTML = `<div class="install-row"><span class="install-ic">${UI.icon('mobile-screen')}</span><div><strong>Add to home screen</strong><p>In Safari, tap the Share button, then choose "Add to Home Screen".</p></div></div>`;
      } else {
        box.innerHTML = `<div class="install-row"><span class="install-ic">${UI.icon('mobile-screen')}</span><div><strong>Install the app</strong><p>Open this site in Chrome, Edge or the Android browser over HTTPS. When installation is available, an Install app button appears here.</p></div></div>`;
      }
    },

    isDirty() { return !!(this.el && this.dirty); },

    destroy() {
      if (this.offPwa) this.offPwa();
      this.el = null;
      this.dirty = false;
    }
  };

  /* ======================================================================
     Backup & restore page
     ====================================================================== */
  const BackupPage = {
    async render(root) {
      this.root = root;
      root.appendChild(UI.pageHeader({ title: 'Backup and restore', subtitle: 'Your invoices live in this browser. Keep a copy somewhere safe.' }));
      this.body = U.el('<div class="backup-grid"></div>');
      root.appendChild(this.body);
      await this.refresh();
    },

    async refresh() {
      if (!this.root || !document.contains(this.root)) return;
      const inv = await DB.count('invoices');
      const last = localStorage.getItem('tci_last_backup');
      const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null;
      const stale = days == null || days >= 7;

      this.body.innerHTML = `
        <section class="panel backup-card">
          <span class="bk-icon">${UI.icon('cloud-arrow-down')}</span>
          <h2 class="panel-title">Export backup</h2>
          <p>Download every invoice and your settings as one JSON file.</p>
          <p class="bk-meta ${stale ? 'is-warn' : ''}">${UI.icon(stale ? 'triangle-exclamation' : 'circle-check')}
            ${last ? `Last backup ${U.esc(U.fmtDateTime(new Date(last).getTime()))}${days ? ` (${days} ${days === 1 ? 'day' : 'days'} ago)` : ''}` : 'No backup exported from this device yet'}</p>
          <p class="bk-counts">${inv} ${inv === 1 ? 'invoice' : 'invoices'}</p>
          <button type="button" class="btn btn-primary" data-act="export">${UI.icon('download')}<span>Export backup</span></button>
        </section>

        <section class="panel backup-card">
          <span class="bk-icon">${UI.icon('cloud-arrow-up')}</span>
          <h2 class="panel-title">Import backup</h2>
          <p>Restore from a backup file. The file is checked first, and you confirm before anything changes.</p>
          <label class="btn btn-ghost file-btn">${UI.icon('upload')}<span>Import backup</span>
            <input type="file" accept="application/json,.json" class="sr-only" data-act="import"></label>
        </section>`;

      this.body.querySelector('[data-act="export"]').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        UI.busy(b, true, 'Preparing');
        try { await Backup.download(); } finally { UI.busy(b, false); this.refresh(); }
      });
      this.body.querySelector('[data-act="import"]').addEventListener('change', (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        Backup.importFile(f);
      });
    },

    destroy() { this.root = null; }
  };

  KR.Backup = Backup;
  KR.SettingsPage = SettingsPage;
  KR.Pages = KR.Pages || {};
  KR.Pages.settings = SettingsPage;
  KR.Pages.backup = BackupPage;
})(window.KR = window.KR || {});
