/* ==========================================================================
   THE CURRENT INVESTMENT — invoices.js
   Invoice generator, A4 template, PDF (with logo watermark) and history.
   ========================================================================== */
(function (KR) {
  'use strict';

  const U = KR.U;
  const UI = KR.UI;
  const DB = KR.DB;

  /* Print helper — renders a dedicated document into #print-root */
  const Print = {
    run(html, docClass = '') {
      const root = document.getElementById('print-root');
      root.innerHTML = `<div class="print-doc ${docClass}">${html}</div>`;
      document.body.classList.add('is-printing');
      const cleanup = () => {
        document.body.classList.remove('is-printing');
        root.innerHTML = '';
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      const imgs = U.$$('img', root);
      const ready = Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 2500); }))));
      ready.then(() => setTimeout(() => window.print(), 60));
    }
  };
  KR.Print = Print;

  const LIBS = {
    jspdf: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'],
    autotable: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js']
  };
  /** Load a library from the first CDN that responds. */
  const loadFirst = async (urls) => {
    let lastErr;
    for (const url of urls) {
      try { await U.loadScript(url); return; } catch (e) { lastErr = e; }
    }
    throw lastErr;
  };

  const STATUSES = [
    { value: 'draft', label: 'Draft' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'paid', label: 'Paid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'cancelled', label: 'Cancelled' }
  ];
  const STATUS_LABEL = { ...Object.fromEntries(STATUSES.map((s) => [s.value, s.label])), partial: 'Partially Paid' };
  const STATUS_ICON = { draft: 'pen-ruler', unpaid: 'clock', partial: 'circle-half-stroke', paid: 'circle-check', overdue: 'circle-exclamation', cancelled: 'ban' };

  const INV_FIELDS = ['id', 'number', 'date', 'dueDate', 'customer', 'discountType', 'discountValue', 'taxRate', 'notes', 'paymentInstructions', 'status', 'statusAuto', 'subtotal', 'discountAmount', 'taxAmount', 'total', 'isDemo', 'createdAt', 'updatedAt'];
  const pickInv = (o) => Object.fromEntries(INV_FIELDS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

  const fmtQty = (q) => (Number.isInteger(Number(q)) ? String(Number(q)) : Number(q).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

  /* ======================================================================
     Service
     ====================================================================== */
  let cache = null;

  const Invoices = {
    STATUSES,
    STATUS_LABEL,

    async load() {
      if (cache) return cache;
      const [invoices, items] = await Promise.all([DB.getAll('invoices'), DB.getAll('invoiceItems')]);
      const byInv = new Map();
      items.forEach((it) => {
        if (!byInv.has(it.invoiceId)) byInv.set(it.invoiceId, []);
        byInv.get(it.invoiceId).push(it);
      });
      const list = invoices.map((inv) => ({
        ...inv,
        items: (byInv.get(inv.id) || []).sort((a, b) => (a.position || 0) - (b.position || 0))
      }));
      list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
      cache = { list, byId: new Map(list.map((i) => [i.id, i])) };
      return cache;
    },
    async all() { return (await Invoices.load()).list; },
    async get(id) { return (await Invoices.load()).byId.get(id) || null; },
    invalidate() { cache = null; },

    calc(items, discountType, discountValue, taxRate) {
      const subtotal = U.round(items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0));
      const dv = Number(discountValue) || 0;
      const discountAmount = U.round(Math.min(subtotal, discountType === 'percent' ? (subtotal * dv) / 100 : dv));
      const taxable = U.round(subtotal - discountAmount);
      const taxAmount = U.round((taxable * (Number(taxRate) || 0)) / 100);
      return { subtotal, discountAmount, taxable, taxAmount, total: U.round(taxable + taxAmount) };
    },

    /** This app has no ledger: an invoice counts as paid only when its status is Paid. */
    async paymentsMap() { return new Map(); },

    paidFor(inv) {
      return inv.status === 'paid' ? (inv.total || 0) : 0;
    },

    taxLabel() { return (KR.settings.taxLabel || 'VAT').trim() || 'VAT'; },

    effectiveStatus(inv) {
      if ((inv.status === 'unpaid' || inv.status === 'partial') && inv.dueDate && inv.dueDate < U.todayISO()) return 'overdue';
      return inv.status;
    },

    badge(status) {
      return `<span class="status status-${status}">${UI.icon(STATUS_ICON[status] || 'circle')}${U.esc(STATUS_LABEL[status] || status)}</span>`;
    },

    seqKey(prefix, year) { return `${prefix}-${year}`; },

    async nextNumber(dateISO) {
      const prefix = (KR.settings.invoicePrefix || 'TCI-INV').trim();
      const year = (dateISO || U.todayISO()).slice(0, 4);
      const base = `${prefix}-${year}-`;
      let max = 0;
      (await Invoices.all()).forEach((i) => {
        if (i.number && i.number.startsWith(base)) {
          const n = parseInt(i.number.slice(base.length), 10);
          if (!isNaN(n)) max = Math.max(max, n);
        }
      });
      const seq = (KR.settings.invoiceSeq || {})[Invoices.seqKey(prefix, year)] || 0;
      return base + String(Math.max(max, seq) + 1).padStart(4, '0');
    },

    async numberTaken(number, exceptId) {
      const n = String(number).trim().toLowerCase();
      return (await Invoices.all()).some((i) => i.id !== exceptId && String(i.number).trim().toLowerCase() === n);
    },

    async save(data) {
      const now = Date.now();
      const existing = data.id ? await DB.get('invoices', data.id) : null;
      const id = data.id || U.uid();
      const items = data.items.map((it, i) => ({
        id: it.id || U.uid(),
        invoiceId: id,
        position: i,
        item: it.item.trim(),
        description: (it.description || '').trim(),
        qty: Number(it.qty),
        unitPrice: U.round(it.unitPrice)
      }));
      const totals = Invoices.calc(items, data.discountType, data.discountValue, data.taxRate);
      const statusChanged = existing && existing.status !== data.status;
      const inv = pickInv({
        ...(existing || {}),
        ...data,
        id,
        number: data.number.trim(),
        ...totals,
        statusAuto: statusChanged ? false : existing ? existing.statusAuto : false,
        isDemo: existing ? !!existing.isDemo : false,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now
      });

      const oldItems = existing ? await DB.getAllByIndex('invoiceItems', 'invoiceId', id) : [];
      const keep = new Set(items.map((i) => i.id));
      const ops = [
        { store: 'invoices', op: 'put', value: inv },
        ...oldItems.filter((o) => !keep.has(o.id)).map((o) => ({ store: 'invoiceItems', op: 'delete', key: o.id })),
        ...items.map((value) => ({ store: 'invoiceItems', op: 'put', value }))
      ];

      // Keep the numbering sequence moving forward.
      const prefix = (KR.settings.invoicePrefix || 'TCI-INV').trim();
      const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4})-(\\d+)$`).exec(inv.number);
      if (m) {
        const seq = { ...(KR.settings.invoiceSeq || {}) };
        const k = Invoices.seqKey(prefix, m[1]);
        const n = parseInt(m[2], 10);
        if (!seq[k] || seq[k] < n) {
          seq[k] = n;
          KR.settings.invoiceSeq = seq;
          ops.push({ store: 'settings', op: 'put', value: { key: 'invoiceSeq', value: seq } });
        }
      }

      await DB.bulk(ops);
      Invoices.invalidate();
      U.emit('data-changed', { entity: 'invoices', action: existing ? 'update' : 'create', id });
      return Invoices.get(id);
    },

    async remove(id) {
      const items = await DB.getAllByIndex('invoiceItems', 'invoiceId', id);
      await DB.bulk([{ store: 'invoices', op: 'delete', key: id }, ...items.map((i) => ({ store: 'invoiceItems', op: 'delete', key: i.id }))]);
      Invoices.invalidate();
      U.emit('data-changed', { entity: 'invoices', action: 'delete', id });
    },

    async duplicate(id) {
      const src = await Invoices.get(id);
      if (!src) return null;
      const date = U.todayISO();
      const copy = {
        ...src,
        id: undefined,
        number: await Invoices.nextNumber(date),
        date,
        dueDate: U.addDays(date, Number(KR.settings.defaultDueDays) || 14),
        status: 'draft',
        statusAuto: false,
        items: src.items.map((it) => ({ ...it, id: undefined }))
      };
      delete copy.createdAt;
      delete copy.updatedAt;
      delete copy.isDemo;
      return Invoices.save(copy);
    },

    async setStatus(id, status) {
      const inv = await DB.get('invoices', id);
      if (!inv) return;
      inv.status = status;
      inv.statusAuto = false;
      inv.updatedAt = Date.now();
      await DB.put('invoices', inv);
      Invoices.invalidate();
      U.emit('data-changed', { entity: 'invoices', action: 'update', id });
    },

    defaultPaymentInstructions() {
      const s = KR.settings;
      return [
        s.paymentInstructions,
        s.bankName ? `Bank: ${s.bankName}` : '',
        s.accountNumber ? `Account Number: ${s.accountNumber}` : '',
        s.accountName ? `Account Name: ${s.accountName}` : '',
        s.mobileMoneyNumber ? `Mobile money: ${s.mobileMoneyNumber}` : '',
        s.tin ? `TIN: ${s.tin}` : ''
      ].filter(Boolean).join('\n');
    },

    logoSrc() {
      const s = KR.settings;
      return s.logoData || s.logoUrl || DB.DEFAULT_LOGO;
    },

    /* ---------------------------------------------------------------
       Printable A4 template (HTML) — used for preview and print
       --------------------------------------------------------------- */
    template(inv, paid = 0) {
      const s = KR.settings;
      const t = Invoices.calc(inv.items, inv.discountType, inv.discountValue, inv.taxRate);
      const status = Invoices.effectiveStatus(inv);
      const balance = inv.status === 'cancelled' ? 0 : Math.max(0, U.round(t.total - paid));
      const logo = Invoices.logoSrc();
      const lines = (arr) => arr.filter(Boolean).map((l) => `<p>${U.esc(l)}</p>`).join('');
      const showStamp = ['paid', 'partial', 'overdue', 'cancelled', 'draft'].includes(status);
      return `
        <article class="invoice-doc">
          ${logo && s.watermark !== false ? `<img class="inv-watermark" src="${U.esc(logo)}" alt="" aria-hidden="true">` : ''}
          <div class="inv-band"></div>
          <header class="inv-header">
            <div class="inv-brand">
              ${logo ? `<img class="inv-logo" src="${U.esc(logo)}" alt="">` : ''}
              <div class="inv-business">
                <h1>${U.esc(s.businessName || 'THE CURRENT INVESTMENT')}</h1>
                ${s.businessTagline ? `<p class="inv-tagline">${U.esc(s.businessTagline)}</p>` : ''}
                ${lines([s.businessAddress, s.businessPhone, s.businessEmail, s.tin ? `TIN: ${s.tin}` : ''])}
              </div>
            </div>
            <div class="inv-title-block">
              <h2 class="inv-title">INVOICE</h2>
              <table class="inv-meta">
                <tr><th>Invoice number</th><td>${U.esc(inv.number)}</td></tr>
                <tr><th>Invoice date</th><td>${U.esc(U.fmtDate(inv.date))}</td></tr>
                <tr><th>Due date</th><td>${U.esc(U.fmtDate(inv.dueDate))}</td></tr>
              </table>
              ${showStamp ? `<span class="inv-stamp inv-stamp-${status}">${U.esc(STATUS_LABEL[status])}</span>` : ''}
            </div>
          </header>

          <section class="inv-parties">
            <div class="inv-billto">
              <h3>Bill to</h3>
              <p class="inv-customer">${U.esc(inv.customer.name)}</p>
              ${lines([inv.customer.phone, inv.customer.email])}
              ${inv.customer.address ? `<p class="pre">${U.esc(inv.customer.address)}</p>` : ''}
            </div>
            <div class="inv-due">
              <h3>${inv.status === 'cancelled' ? 'Invoice cancelled' : 'Amount due'}</h3>
              <p class="inv-due-amt">${U.esc(U.money(balance))}</p>
              <p>${inv.status === 'cancelled' ? 'No payment required' : `Due by ${U.esc(U.fmtDate(inv.dueDate))}`}</p>
            </div>
          </section>

          <table class="inv-items">
            <thead><tr><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${inv.items.map((it) => `
                <tr>
                  <td class="inv-item-name">${U.esc(it.item)}</td>
                  <td class="inv-item-desc">${U.esc(it.description)}</td>
                  <td class="num">${U.esc(fmtQty(it.qty))}</td>
                  <td class="num nowrap">${U.esc(U.money(it.unitPrice))}</td>
                  <td class="num nowrap">${U.esc(U.money(U.round(it.qty * it.unitPrice)))}</td>
                </tr>`).join('')}
            </tbody>
          </table>

          <div class="inv-totals-wrap">
            <table class="inv-totals">
              <tr><th>Subtotal</th><td>${U.esc(U.money(t.subtotal))}</td></tr>
              ${t.discountAmount ? `<tr><th>Discount${inv.discountType === 'percent' && Number(inv.discountValue) ? ` (${U.esc(inv.discountValue)}%)` : ''}</th><td>- ${U.esc(U.money(t.discountAmount))}</td></tr>` : ''}
              <tr><th>${U.esc(Invoices.taxLabel())}${Number(inv.taxRate) ? ` (${U.esc(inv.taxRate)}%)` : ''}</th><td>${U.esc(U.money(t.taxAmount))}</td></tr>
              <tr class="inv-grand"><th>TOTAL</th><td>${U.esc(U.money(t.total))}</td></tr>
              ${paid > 0 ? `<tr class="inv-paid"><th>Paid</th><td>- ${U.esc(U.money(paid))}</td></tr>
              <tr class="inv-balance"><th>Balance due</th><td>${U.esc(U.money(balance))}</td></tr>` : ''}
            </table>
          </div>

          <section class="inv-foot-grid">
            <div>
              <h3>Payment instructions</h3>
              <p class="pre">${inv.paymentInstructions ? U.esc(inv.paymentInstructions) : '<span class="inv-muted">Contact us for payment details.</span>'}</p>
            </div>
            ${inv.notes ? `<div><h3>Notes</h3><p class="pre">${U.esc(inv.notes)}</p></div>` : ''}
          </section>

          <p class="inv-thanks">${U.esc(s.invoiceThankYou || 'Thank you for your business.')}</p>
          <footer class="inv-footer">${[s.businessName, s.businessPhone, s.businessEmail].filter(Boolean).map(U.esc).join('<span class="sep"></span>')}</footer>
        </article>`;
    },

    async paidAmount(inv) {
      if (!inv.id) return 0;
      return Invoices.paidFor(inv, await Invoices.paymentsMap());
    },

    async print(inv) {
      const paid = await Invoices.paidAmount(inv);
      KR.Print.run(Invoices.template(inv, paid), 'invoice-print');
    },

    /* ---------------------------------------------------------------
       PDF (vector text via jsPDF + AutoTable, proper A4 pagination)
       --------------------------------------------------------------- */
    async logoImage() {
      const src = Invoices.logoSrc();
      if (!src) return null;
      const url = src.startsWith('data:') ? src : src + (src.includes('?') ? '&' : '?') + 'kr-pdf=1';
      try { return await U.imageToDataURL(url, 600); } catch (e) { return null; }
    },

    async pdf(inv) {
      try {
        if (!(window.jspdf && window.jspdf.jsPDF)) await loadFirst(LIBS.jspdf);
        if (!(window.jspdf.jsPDF.prototype.autoTable)) await loadFirst(LIBS.autotable);
      } catch (e) {
        UI.toast('The PDF tool needs an internet connection the first time. Use Print and choose "Save as PDF" instead.', { type: 'error', title: 'PDF unavailable' });
        return false;
      }
      const s = KR.settings;
      const paid = await Invoices.paidAmount(inv);
      const t = Invoices.calc(inv.items, inv.discountType, inv.discountValue, inv.taxRate);
      const status = Invoices.effectiveStatus(inv);
      const balance = inv.status === 'cancelled' ? 0 : Math.max(0, U.round(t.total - paid));
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const W = 210, H = 297, M = 16, R = W - M;
      const C = { brand: [31, 72, 201], ink: [20, 27, 45], muted: [96, 106, 122], line: [222, 227, 234], soft: [243, 245, 248], white: [255, 255, 255] };
      const money = (n) => `${U.currency()} ${U.num(n)}`;
      const safe = (str) => String(str || '').replace(/[\u2012-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
      const setText = (size, style, color) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };

      doc.setProperties({ title: `Invoice ${inv.number}`, subject: `Invoice for ${inv.customer.name}`, author: s.businessName, creator: s.appName });

      // Top band
      doc.setFillColor(...C.brand);
      doc.rect(0, 0, W, 2.5, 'F');

      // Brand block
      let y = 16;
      let textX = M;
      const logo = await Invoices.logoImage();
      if (logo) {
        const h = 24;
        const w = Math.min(44, (h * logo.width) / logo.height);
        doc.addImage(logo.data, 'PNG', M, y - 6, w, h);
        textX = M + w + 5;
      }
      setText(15, 'bold', C.ink);
      doc.text(safe(s.businessName || 'THE CURRENT INVESTMENT'), textX, y + 3);
      let cy = y + 8.5;
      if (s.businessTagline) {
        setText(8.5, 'italic', C.brand);
        doc.text(safe(s.businessTagline), textX, cy);
        cy += 4.5;
      }
      setText(8.5, 'normal', C.muted);
      [s.businessAddress, s.businessPhone, s.businessEmail, s.tin ? `TIN: ${s.tin}` : ''].filter(Boolean).forEach((l) => {
        const parts = doc.splitTextToSize(safe(l), 80);
        doc.text(parts, textX, cy);
        cy += parts.length * 4;
      });

      // Title + meta
      setText(24, 'bold', C.brand);
      doc.text('INVOICE', R, y + 4, { align: 'right' });
      let my = y + 12;
      [['Invoice number', inv.number], ['Invoice date', U.fmtDate(inv.date)], ['Due date', U.fmtDate(inv.dueDate)]].forEach(([k, v]) => {
        setText(8.5, 'normal', C.muted);
        doc.text(k, R - 68, my);
        setText(8.5, 'bold', C.ink);
        doc.text(safe(v), R, my, { align: 'right' });
        my += 5;
      });
      if (['paid', 'partial', 'overdue', 'cancelled', 'draft'].includes(status)) {
        const label = STATUS_LABEL[status].toUpperCase();
        const colors = { paid: [14, 138, 95], partial: [31, 72, 201], overdue: [200, 55, 45], cancelled: [96, 106, 122], draft: [96, 106, 122] };
        setText(8, 'bold', colors[status]);
        const tw = doc.getTextWidth(label) + 6;
        doc.setDrawColor(...colors[status]);
        doc.setLineWidth(0.4);
        doc.roundedRect(R - tw, my - 1, tw, 6, 1.2, 1.2, 'S');
        doc.text(label, R - tw / 2, my + 3.2, { align: 'center' });
        my += 8;
      }

      y = Math.max(cy, my, y + 22) + 4;
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.line(M, y, R, y);
      y += 8;

      // Bill to + amount due
      setText(8.5, 'bold', C.muted);
      doc.text('Bill to', M, y);
      setText(11.5, 'bold', C.ink);
      const nameLines = doc.splitTextToSize(safe(inv.customer.name), 100);
      doc.text(nameLines, M, y + 6);
      let by = y + 6 + nameLines.length * 5;
      setText(9, 'normal', C.muted);
      [inv.customer.phone, inv.customer.email, inv.customer.address].filter(Boolean).forEach((l) => {
        const parts = doc.splitTextToSize(safe(l), 100);
        doc.text(parts, M, by);
        by += parts.length * 4.3;
      });
      const boxW = 64;
      doc.setFillColor(...C.soft);
      doc.roundedRect(R - boxW, y - 4, boxW, 25, 2, 2, 'F');
      setText(8.5, 'bold', C.muted);
      doc.text(inv.status === 'cancelled' ? 'Invoice cancelled' : 'Amount due', R - boxW + 5, y + 2);
      setText(15, 'bold', C.ink);
      doc.text(money(balance), R - boxW + 5, y + 10.5);
      setText(8.5, 'normal', C.muted);
      doc.text(inv.status === 'cancelled' ? 'No payment required' : `Due by ${U.fmtDate(inv.dueDate)}`, R - boxW + 5, y + 16.5);
      y = Math.max(by, y + 21) + 8;

      // Items
      const footer = () => {
        const pages = doc.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
          doc.setPage(i);
          // Logo watermark in the middle of every page
          if (logo && s.watermark !== false) {
            const ww = 120;
            const wh = (ww * logo.height) / logo.width;
            const canFade = typeof doc.GState === 'function' && typeof doc.setGState === 'function';
            if (canFade) {
              doc.saveGraphicsState();
              doc.setGState(new doc.GState({ opacity: 0.07 }));
            }
            if (canFade || logo.faded) doc.addImage(canFade ? logo.data : logo.faded, 'PNG', (W - ww) / 2, (H - wh) / 2, ww, wh, 'wm', 'FAST');
            if (canFade) doc.restoreGraphicsState();
          }
          doc.setDrawColor(...C.line);
          doc.setLineWidth(0.3);
          doc.line(M, H - 14, R, H - 14);
          setText(7.5, 'normal', C.muted);
          doc.text(safe([s.businessName, s.businessPhone, s.businessEmail].filter(Boolean).join('   |   ')), M, H - 9);
          doc.text(`${inv.number}   |   Page ${i} of ${pages}`, R, H - 9, { align: 'right' });
        }
      };

      doc.autoTable({
        startY: y,
        margin: { left: M, right: M, bottom: 22, top: 18 },
        head: [['Item', 'Description', 'Qty', 'Price', 'Total']],
        body: inv.items.map((it) => [safe(it.item), safe(it.description), fmtQty(it.qty), money(it.unitPrice), money(U.round(it.qty * it.unitPrice))]),
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, textColor: C.ink, cellPadding: { top: 3.2, bottom: 3.2, left: 2.5, right: 2.5 }, overflow: 'linebreak', valign: 'top' },
        headStyles: { fillColor: C.soft, textColor: C.muted, fontStyle: 'bold', fontSize: 8.5 },
        columnStyles: {
          0: { cellWidth: 44, fontStyle: 'bold' },
          1: { cellWidth: 'auto', textColor: C.muted },
          2: { cellWidth: 14, halign: 'right' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' }
        },
        didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; },
        didDrawCell: (d) => {
          if (d.section === 'body') {
            doc.setDrawColor(...C.line);
            doc.setLineWidth(0.25);
            doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
          }
        }
      });
      y = doc.lastAutoTable.finalY + 7;

      const ensure = (need) => {
        if (y + need > H - 24) { doc.addPage(); y = 20; }
      };

      // Totals
      const rows = [
        ['Subtotal', money(t.subtotal)],
        [`Discount${inv.discountType === 'percent' && Number(inv.discountValue) ? ` (${inv.discountValue}%)` : ''}`, '- ' + money(t.discountAmount)],
        [`${Invoices.taxLabel()}${Number(inv.taxRate) ? ` (${inv.taxRate}%)` : ''}`, money(t.taxAmount)]
      ].filter((r, i) => i !== 1 || t.discountAmount);
      ensure(rows.length * 6 + 14 + (paid > 0 ? 14 : 0));
      const x1 = R - 82;
      rows.forEach(([k, v]) => {
        setText(9, 'normal', C.muted);
        doc.text(k, x1, y);
        setText(9, 'normal', C.ink);
        doc.text(v, R - 3, y, { align: 'right' });
        y += 6;
      });
      doc.setFillColor(...C.brand);
      doc.roundedRect(x1 - 3, y - 4.2, R - x1 + 3, 10, 1.5, 1.5, 'F');
      setText(10.5, 'bold', C.white);
      doc.text('TOTAL', x1, y + 2.3);
      doc.text(money(t.total), R - 3, y + 2.3, { align: 'right' });
      y += 13;
      if (paid > 0) {
        setText(9, 'normal', C.muted);
        doc.text('Paid', x1, y);
        doc.text(`- ${money(paid)}`, R - 3, y, { align: 'right' });
        y += 6;
        setText(9.5, 'bold', C.ink);
        doc.text('Balance due', x1, y);
        doc.text(money(balance), R - 3, y, { align: 'right' });
        y += 8;
      }
      y += 4;

      // Payment instructions & notes
      const colW = inv.notes ? (R - M - 10) / 2 : R - M;
      const payText = doc.splitTextToSize(safe(inv.paymentInstructions || 'Contact us for payment details.'), colW);
      const noteText = inv.notes ? doc.splitTextToSize(safe(inv.notes), colW) : [];
      const blockH = Math.max(payText.length, noteText.length) * 4.4 + 10;
      ensure(Math.min(blockH, 120));
      doc.setDrawColor(...C.line);
      doc.line(M, y, R, y);
      y += 7;
      setText(9, 'bold', C.ink);
      doc.text('Payment instructions', M, y);
      if (inv.notes) doc.text('Notes', M + colW + 10, y);
      setText(9, 'normal', C.muted);
      const startY = y + 5.5;
      const drawLines = (lines, x) => {
        let ly = startY;
        lines.forEach((ln) => {
          if (ly > H - 24) { doc.addPage(); ly = 20; }
          doc.text(ln, x, ly);
          ly += 4.4;
        });
        return ly;
      };
      const pageBefore = doc.getNumberOfPages();
      const endPay = drawLines(payText, M);
      const pageAfterPay = doc.getNumberOfPages();
      if (noteText.length) {
        doc.setPage(pageBefore);
        const endNotes = drawLines(noteText, M + colW + 10);
        doc.setPage(Math.max(pageAfterPay, doc.getNumberOfPages()));
        y = Math.max(endPay, endNotes);
      } else {
        y = endPay;
      }
      y += 8;
      ensure(10);
      setText(10, 'bold', C.brand);
      doc.text(safe(s.invoiceThankYou || 'Thank you for your business.'), M, y);

      footer();
      const file = `${U.fileSlug(inv.number) || 'invoice'}_${U.fileSlug(inv.customer.name) || 'customer'}.pdf`;
      doc.save(file);
      return true;
    },

    /* ---------------------------------------------------------------
       Modals
       --------------------------------------------------------------- */
    async preview(inv, { onEdit } = {}) {
      const paid = await Invoices.paidAmount(inv);
      const saved = !!(inv.id && (await Invoices.get(inv.id)));
      const m = UI.modal({
        title: `Invoice ${inv.number}`,
        subtitle: inv.customer.name,
        size: 'xl',
        className: 'modal-preview',
        sheet: false,
        body: `<div class="preview-stage"><div class="preview-scale">${Invoices.template(inv, paid)}</div></div>`,
        footer: `
          ${onEdit || saved ? `<button type="button" class="btn btn-ghost" data-act="edit">${UI.icon('pen')}<span>Edit invoice</span></button>` : ''}
          <span class="foot-spacer"></span>
          <button type="button" class="btn btn-ghost" data-act="print">${UI.icon('print')}<span>Print</span></button>
          <button type="button" class="btn btn-primary" data-act="pdf">${UI.icon('file-pdf')}<span>Download PDF</span></button>`
      });
      const stage = m.body.querySelector('.preview-stage');
      const scaler = m.body.querySelector('.preview-scale');
      const fit = () => {
        const docEl = scaler.firstElementChild;
        const avail = stage.clientWidth;
        const scale = Math.min(1, avail / 794);
        scaler.style.transform = `scale(${scale})`;
        stage.style.height = `${docEl.offsetHeight * scale}px`;
      };
      const ro = new ResizeObserver(fit);
      ro.observe(stage);
      U.$$('img', scaler).forEach((img) => img.addEventListener('load', fit));
      requestAnimationFrame(fit);
      const f = m.footer;
      const on = (act, fn) => { const b = f.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', fn); };
      on('edit', () => { m.close(); if (onEdit) onEdit(); else KR.App.go('invoice-create', { id: inv.id }); });
      on('print', () => Invoices.print(inv));
      on('pdf', async (e) => {
        const b = e.currentTarget;
        UI.busy(b, true, 'Preparing PDF');
        const ok = await Invoices.pdf(inv);
        UI.busy(b, false);
        if (ok) UI.toast(`${inv.number} was downloaded.`, { title: 'PDF ready' });
      });
      const origClose = m.close;
      m.close = (r) => { ro.disconnect(); origClose(r); };
    },

    async changeStatus(id) {
      const inv = await Invoices.get(id);
      if (!inv) return;
      const m = UI.modal({
        title: 'Change status',
        subtitle: inv.number,
        size: 'sm',
        body: `
          <form class="stack" novalidate>
            <div class="status-options" role="radiogroup" aria-label="Invoice status">
              ${STATUSES.map((s) => `
                <label class="status-option"><input type="radio" name="st" value="${s.value}" ${s.value === inv.status ? 'checked' : ''}>
                  ${Invoices.badge(s.value)}</label>`).join('')}
            </div>
          </form>`,
        footer: `<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
                 <button type="button" class="btn btn-primary" data-act="save">Save status</button>`
      });
      m.footer.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.footer.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const v = m.body.querySelector('input[name="st"]:checked').value;
        await Invoices.setStatus(id, v);
        m.close();
        UI.toast(`${inv.number} is now ${STATUS_LABEL[v].toLowerCase()}.`, { title: 'Status updated' });
      });
    },

    async confirmDelete(id) {
      const inv = await Invoices.get(id);
      if (!inv) return false;
      const ok = await UI.confirm({
        title: 'Delete this invoice?',
        html: `<p class="confirm-quote"><strong>${U.esc(inv.number)}</strong><br>${U.esc(inv.customer.name)}, ${U.esc(U.money(inv.total))}</p>
               <p>The invoice will be removed from this device. This cannot be undone.</p>`,
        confirmText: 'Delete invoice'
      });
      if (!ok) return false;
      await Invoices.remove(id);
      UI.toast(`${inv.number} was deleted.`, { title: 'Invoice deleted' });
      return true;
    },

    async duplicateAndOpen(id) {
      const copy = await Invoices.duplicate(id);
      if (!copy) return;
      UI.toast(`Created ${copy.number} as a draft copy.`, { title: 'Invoice duplicated' });
      KR.App.go('invoice-create', { id: copy.id });
    },

    async downloadPdf(id, btn) {
      const inv = await Invoices.get(id);
      if (!inv) return;
      if (btn) UI.busy(btn, true, 'Preparing PDF');
      const ok = await Invoices.pdf(inv);
      if (btn) UI.busy(btn, false);
      if (ok) UI.toast(`${inv.number} was downloaded.`, { title: 'PDF ready' });
    },

    rowMenu(anchor, inv) {
      UI.menu(anchor, [
        { label: 'Preview', icon: 'eye', onClick: () => Invoices.preview(inv) },
        { label: 'Edit invoice', icon: 'pen', onClick: () => KR.App.go('invoice-create', { id: inv.id }) },
        { label: 'Print', icon: 'print', onClick: () => Invoices.print(inv) },
        { label: 'Download PDF', icon: 'file-pdf', onClick: () => Invoices.downloadPdf(inv.id) },
        { label: 'Duplicate', icon: 'clone', onClick: () => Invoices.duplicateAndOpen(inv.id) },
        { divider: true },
        (inv.status !== 'paid' && inv.status !== 'cancelled') ? { label: 'Mark as paid', icon: 'circle-check', onClick: async () => { await Invoices.setStatus(inv.id, 'paid'); UI.toast(`${inv.number} is now paid.`, { title: 'Status updated' }); } } : null,
        { label: 'Change status', icon: 'tag', onClick: () => Invoices.changeStatus(inv.id) },
        { divider: true },
        { label: 'Delete', icon: 'trash-can', danger: true, onClick: () => Invoices.confirmDelete(inv.id) }
      ]);
    }
  };

  /* ======================================================================
     Invoice generator page
     ====================================================================== */
  const GeneratorPage = {
    async render(root, params) {
      this.root = root;
      this.dirty = false;
      let inv = null;
      if (params.id) {
        inv = await Invoices.get(params.id);
        if (!inv) {
          root.appendChild(UI.pageHeader({ title: 'Invoice generator' }));
          root.appendChild(UI.empty({ icon: 'file-circle-question', title: 'Invoice not found', text: 'It may have been deleted.', actionLabel: 'Create a new invoice', onAction: () => KR.App.go('invoice-create', {}, true) }));
          return;
        }
      }
      this.savedId = inv ? inv.id : null;
      const s = KR.settings;
      const date = inv ? inv.date : U.todayISO();
      const data = inv ? JSON.parse(JSON.stringify(inv)) : {
        number: await Invoices.nextNumber(date),
        date,
        dueDate: U.addDays(date, Number(s.defaultDueDays) || 14),
        status: 'unpaid',
        customer: { name: '', phone: '', email: '', address: '' },
        items: [{ item: '', description: '', qty: 1, unitPrice: '' }],
        discountType: 'amount',
        discountValue: 0,
        taxRate: Number(s.defaultTaxRate) || 0,
        notes: '',
        paymentInstructions: Invoices.defaultPaymentInstructions()
      };

      root.appendChild(UI.pageHeader({
        title: inv ? `Edit ${inv.number}` : 'Invoice generator',
        subtitle: 'Your business details come from Settings and can be changed at any time.'
      }));

      const statusOpts = STATUSES.filter((x) => x.value !== 'overdue' || data.status === 'overdue');
      if (data.status === 'partial') statusOpts.splice(2, 0, { value: 'partial', label: STATUS_LABEL.partial });
      const uid = U.uid().slice(0, 6);
      const el = U.el(`
        <div class="invoice-editor">
          <form class="inv-form" novalidate>
            <section class="panel">
              <div class="panel-head"><h2 class="panel-title">Invoice details</h2></div>
              <div class="form-grid cols-4">
                <div class="field"><label for="inv-num-${uid}">Invoice number</label><input id="inv-num-${uid}" class="input" name="number" value="${U.esc(data.number)}" autocapitalize="characters"></div>
                <div class="field"><label for="inv-status-${uid}">Status</label><select id="inv-status-${uid}" class="input" name="status">${UI.options(statusOpts, data.status)}</select></div>
                <div class="field"><label for="inv-date-${uid}">Invoice date</label><input id="inv-date-${uid}" type="date" class="input" name="date" value="${U.esc(data.date)}"></div>
                <div class="field"><label for="inv-due-${uid}">Due date</label><input id="inv-due-${uid}" type="date" class="input" name="dueDate" value="${U.esc(data.dueDate)}"></div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head"><h2 class="panel-title">Bill to</h2></div>
              <div class="form-grid">
                <div class="field"><label for="c-name-${uid}">Customer name</label><input id="c-name-${uid}" class="input" name="c_name" value="${U.esc(data.customer.name)}" autocomplete="off"></div>
                <div class="field"><label for="c-phone-${uid}">Customer phone <span class="optional">Optional</span></label><input id="c-phone-${uid}" type="tel" inputmode="tel" class="input" name="c_phone" value="${U.esc(data.customer.phone)}"></div>
                <div class="field"><label for="c-email-${uid}">Customer email <span class="optional">Optional</span></label><input id="c-email-${uid}" type="email" inputmode="email" class="input" name="c_email" value="${U.esc(data.customer.email)}"></div>
                <div class="field"><label for="c-addr-${uid}">Customer address <span class="optional">Optional</span></label><textarea id="c-addr-${uid}" class="input" name="c_address" rows="1">${U.esc(data.customer.address)}</textarea></div>
              </div>
            </section>

            <section class="panel items-panel">
              <div class="panel-head"><h2 class="panel-title">Items and services</h2></div>
              <div class="items-head" aria-hidden="true"><span>Item / service and description</span><span>Qty</span><span>Unit price</span><span class="num">Total</span><span></span></div>
              <div class="items-list"></div>
              <button type="button" class="btn btn-ghost add-item">${UI.icon('plus')}<span>Add item</span></button>
            </section>

            <section class="panel">
              <div class="panel-head"><h2 class="panel-title">Discount and ${U.esc(Invoices.taxLabel())}</h2></div>
              <div class="form-grid cols-3">
                <div class="field"><label for="d-type-${uid}">Discount type</label><select id="d-type-${uid}" class="input" name="discountType">${UI.options([{ value: 'amount', label: `Fixed amount (${U.currency()})` }, { value: 'percent', label: 'Percentage (%)' }], data.discountType)}</select></div>
                <div class="field"><label for="d-val-${uid}">Discount</label><input id="d-val-${uid}" class="input" name="discountValue" inputmode="decimal" placeholder="0" value="${Number(data.discountValue) ? U.esc(data.discountType === 'amount' ? U.formatAmountInput(data.discountValue) : data.discountValue) : ''}"></div>
                <div class="field"><label for="tax-${uid}">${U.esc(Invoices.taxLabel())} rate (%)</label><input id="tax-${uid}" class="input" name="taxRate" type="number" min="0" max="100" step="any" inputmode="decimal" value="${U.esc(data.taxRate)}"></div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head">
                <h2 class="panel-title">Payment instructions and notes</h2>
                <button type="button" class="btn btn-ghost btn-sm use-saved">${UI.icon('rotate')}<span>Use saved payment details</span></button>
              </div>
              <div class="form-grid">
                <div class="field"><label for="pay-ins-${uid}">Payment instructions</label>
                  <textarea id="pay-ins-${uid}" class="input" name="paymentInstructions" rows="4" placeholder="Add bank or mobile money details here, or save them once in Settings.">${U.esc(data.paymentInstructions)}</textarea></div>
                <div class="field"><label for="notes-${uid}">Notes <span class="optional">Optional</span></label>
                  <textarea id="notes-${uid}" class="input" name="notes" rows="4" placeholder="e.g. Warranty covers 6 months from installation.">${U.esc(data.notes)}</textarea></div>
              </div>
            </section>
          </form>

          <aside class="inv-summary">
            <div class="panel summary-card">
              <div class="panel-head"><h2 class="panel-title">Summary</h2><span class="sum-status"></span></div>
              <dl class="sum-lines">
                <div><dt>Subtotal</dt><dd data-sum="subtotal"></dd></div>
                <div><dt>Discount</dt><dd data-sum="discount"></dd></div>
                <div><dt>${U.esc(Invoices.taxLabel())}</dt><dd data-sum="tax"></dd></div>
                <div class="sum-total"><dt>Grand total</dt><dd data-sum="total"></dd></div>
                <div class="sum-paid" hidden><dt>Paid</dt><dd data-sum="paid"></dd></div>
              </dl>
              <div class="sum-actions">
                <button type="button" class="btn btn-primary btn-block" data-act="save">${UI.icon('floppy-disk')}<span>Save invoice</span></button>
                <div class="btn-row">
                  <button type="button" class="btn btn-ghost" data-act="preview">${UI.icon('eye')}<span>Preview</span></button>
                  <button type="button" class="btn btn-ghost" data-act="print">${UI.icon('print')}<span>Print</span></button>
                </div>
                <button type="button" class="btn btn-ghost btn-block" data-act="pdf">${UI.icon('file-pdf')}<span>Download PDF</span></button>
              </div>
              <div class="saved-actions" hidden>
                <div class="btn-row">
                  <button type="button" class="btn btn-ghost" data-act="duplicate">${UI.icon('clone')}<span>Duplicate</span></button>
                  <button type="button" class="btn btn-ghost btn-danger-text" data-act="delete">${UI.icon('trash-can')}<span>Delete</span></button>
                </div>
              </div>
              <p class="sum-note">${UI.icon('circle-info')} Business details, logo and bank details come from <a href="#/settings">Settings</a>.</p>
            </div>
          </aside>

          <div class="mobile-bar inv-mobile-bar">
            <div class="mb-total"><span>Grand total</span><strong data-sum="total"></strong></div>
            <button type="button" class="btn btn-ghost btn-square" data-act="more" aria-label="More invoice actions" aria-haspopup="menu">${UI.icon('ellipsis-vertical')}</button>
            <button type="button" class="btn btn-ghost" data-act="preview">${UI.icon('eye')}<span>Preview</span></button>
            <button type="button" class="btn btn-primary" data-act="save">${UI.icon('floppy-disk')}<span>Save</span></button>
          </div>
        </div>`);
      root.appendChild(el);
      this.el = el;
      this.form = el.querySelector('.inv-form');
      this.itemsList = el.querySelector('.items-list');
      this.paid = inv ? await Invoices.paidAmount(inv) : 0;

      data.items.forEach((it) => this.addItemRow(it));
      UI.bindAmount(this.form.querySelector('[name="discountValue"]'));
      UI.autoClearErrors(this.form);

      const f = this.form;
      f.addEventListener('input', () => { this.dirty = true; this.updateTotals(); });
      f.addEventListener('change', (e) => {
        this.dirty = true;
        if (e.target.name === 'discountType') {
          const dv = f.querySelector('[name="discountValue"]');
          dv.value = '';
        }
        if (e.target.name === 'date' && !this.savedId && U.isValidISO(e.target.value)) {
          f.querySelector('[name="dueDate"]').value = U.addDays(e.target.value, Number(KR.settings.defaultDueDays) || 14);
        }
        this.updateTotals();
      });
      f.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });

      el.querySelector('.add-item').addEventListener('click', () => {
        const row = this.addItemRow({ item: '', description: '', qty: 1, unitPrice: '' });
        row.querySelector('[name="item"]').focus();
        this.dirty = true;
        this.updateTotals();
      });
      el.querySelector('.use-saved').addEventListener('click', () => {
        const text = Invoices.defaultPaymentInstructions();
        if (!text) {
          UI.toast('Add bank, mobile money or payment instructions in Settings first.', { type: 'info', title: 'No saved payment details', action: { label: 'Open settings', onClick: () => KR.App.go('settings') } });
          return;
        }
        f.querySelector('[name="paymentInstructions"]').value = text;
        this.dirty = true;
      });

      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b || b.closest('.item-row')) return;
        this.action(b.dataset.act, b);
      });

      this.updateTotals();
      this.syncSavedUI();
    },

    addItemRow(it) {
      const row = U.el(`
        <div class="item-row">
          <div class="field f-item"><label class="m-label">Item / service</label><input class="input" name="item" value="${U.esc(it.item)}" placeholder="e.g. Generator exhaust pipe"></div>
          <div class="field f-desc"><label class="m-label">Description</label><input class="input" name="description" value="${U.esc(it.description)}" placeholder="Description (optional)"></div>
          <div class="field f-qty"><label class="m-label">Qty</label><input class="input" name="qty" type="number" min="0" step="any" inputmode="decimal" value="${U.esc(it.qty)}"></div>
          <div class="field f-price"><label class="m-label">Unit price</label><input class="input" name="unitPrice" inputmode="decimal" value="${it.unitPrice === '' ? '' : U.esc(U.formatAmountInput(it.unitPrice))}" placeholder="0"></div>
          <div class="f-total"><span class="m-label">Total</span><strong class="line-total"></strong></div>
          <button type="button" class="icon-btn danger remove-item" aria-label="Remove item" data-tip="Remove">${UI.icon('xmark')}</button>
        </div>`);
      if (it.id) row.dataset.id = it.id;
      row.querySelectorAll('label.m-label').forEach((l) => {
        const input = l.nextElementSibling;
        const id = 'it-' + U.uid().slice(0, 8);
        input.id = id;
        l.setAttribute('for', id);
      });
      UI.bindAmount(row.querySelector('[name="unitPrice"]'));
      row.querySelector('.remove-item').addEventListener('click', () => {
        if (this.itemsList.children.length === 1) {
          row.querySelectorAll('input').forEach((i) => { i.value = i.name === 'qty' ? '1' : ''; });
          delete row.dataset.id;
        } else {
          row.remove();
        }
        this.dirty = true;
        this.updateTotals();
      });
      this.itemsList.appendChild(row);
      return row;
    },

    read() {
      const f = this.form;
      const val = (n) => f.querySelector(`[name="${n}"]`).value;
      const discountType = val('discountType');
      const items = U.$$('.item-row', this.itemsList).map((row) => ({
        id: row.dataset.id || undefined,
        item: row.querySelector('[name="item"]').value,
        description: row.querySelector('[name="description"]').value,
        qty: row.querySelector('[name="qty"]').value === '' ? NaN : Number(row.querySelector('[name="qty"]').value),
        unitPrice: U.parseAmount(row.querySelector('[name="unitPrice"]').value),
        _row: row
      }));
      return {
        id: this.savedId || undefined,
        number: val('number'),
        status: val('status'),
        date: val('date'),
        dueDate: val('dueDate'),
        customer: { name: val('c_name').trim(), phone: val('c_phone').trim(), email: val('c_email').trim(), address: val('c_address').trim() },
        items,
        discountType,
        discountValue: discountType === 'amount' ? (U.parseAmount(val('discountValue')) || 0) : (Number(val('discountValue')) || 0),
        taxRate: Number(val('taxRate')) || 0,
        notes: val('notes').trim(),
        paymentInstructions: val('paymentInstructions').trim()
      };
    },

    updateTotals() {
      if (!this.el) return;
      const d = this.read();
      U.$$('.item-row', this.itemsList).forEach((row, i) => {
        const it = d.items[i];
        const line = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
        row.querySelector('.line-total').textContent = U.money(U.round(line));
      });
      const valid = d.items.filter((it) => it.item.trim() || it.unitPrice);
      const t = Invoices.calc(valid, d.discountType, d.discountValue, d.taxRate);
      const set = (k, v) => U.$$(`[data-sum="${k}"]`, this.el).forEach((n) => { n.textContent = v; });
      set('subtotal', U.money(t.subtotal));
      set('discount', (t.discountAmount ? '- ' : '') + U.money(t.discountAmount));
      set('tax', U.money(t.taxAmount));
      set('total', U.money(t.total));
      const paidRow = this.el.querySelector('.sum-paid');
      paidRow.hidden = !(this.paid > 0);
      set('paid', U.money(this.paid));
      const pseudo = { status: d.status, dueDate: d.dueDate };
      this.el.querySelector('.sum-status').innerHTML = Invoices.badge(Invoices.effectiveStatus(pseudo));
    },

    async validate() {
      const d = this.read();
      const f = this.form;
      UI.clearFieldErrors(f);
      const errs = [];
      const err = (ctl, msg) => { UI.fieldError(ctl, msg); errs.push(ctl); };
      const ctl = (n) => f.querySelector(`[name="${n}"]`);

      if (!d.number.trim()) err(ctl('number'), 'Enter an invoice number.');
      else if (await Invoices.numberTaken(d.number, this.savedId)) err(ctl('number'), 'Another invoice already uses this number.');
      if (!U.isValidISO(d.date)) err(ctl('date'), 'Enter a valid invoice date.');
      if (!U.isValidISO(d.dueDate)) err(ctl('dueDate'), 'Enter a valid due date.');
      else if (U.isValidISO(d.date) && d.dueDate < d.date) err(ctl('dueDate'), 'Due date must be on or after the invoice date.');
      if (!d.customer.name) err(ctl('c_name'), 'Enter the customer name.');
      if (d.customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.customer.email)) err(ctl('c_email'), 'Enter a valid email address.');

      const filled = d.items.filter((it) => it.item.trim() || it.description.trim() || it.unitPrice);
      if (!filled.length) {
        err(d.items[0]._row.querySelector('[name="item"]'), 'Add at least one item or service.');
      }
      filled.forEach((it) => {
        if (!it.item.trim()) err(it._row.querySelector('[name="item"]'), 'Enter the item name.');
        if (!(it.qty > 0)) err(it._row.querySelector('[name="qty"]'), 'Qty must be above 0.');
        if (isNaN(it.unitPrice) || it.unitPrice < 0) err(it._row.querySelector('[name="unitPrice"]'), 'Enter a price.');
      });

      const subtotal = filled.reduce((a, it) => a + (it.qty || 0) * (it.unitPrice || 0), 0);
      if (d.discountValue < 0) err(ctl('discountValue'), 'Discount cannot be negative.');
      else if (d.discountType === 'percent' && d.discountValue > 100) err(ctl('discountValue'), 'Percentage cannot exceed 100.');
      else if (d.discountType === 'amount' && d.discountValue > subtotal) err(ctl('discountValue'), 'Discount cannot exceed the subtotal.');
      if (d.taxRate < 0 || d.taxRate > 100) err(ctl('taxRate'), 'Tax rate must be between 0 and 100.');

      if (errs.length) {
        errs[0].focus({ preventScroll: true });
        errs[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        UI.toast('Fix the highlighted fields to continue.', { type: 'error', title: 'Invoice incomplete' });
        return null;
      }
      d.items = filled.map(({ _row, ...rest }) => rest);
      return d;
    },

    async save() {
      const btns = U.$$('[data-act="save"]', this.el);
      const d = await this.validate();
      if (!d) return null;
      btns.forEach((b) => UI.busy(b, true, 'Saving'));
      try {
        const saved = await Invoices.save(d);
        this.savedId = saved.id;
        this.dirty = false;
        // Map saved item ids back to rows so later edits update instead of duplicating.
        const rows = U.$$('.item-row', this.itemsList).filter((r) => r.querySelector('[name="item"]').value.trim());
        rows.forEach((r, i) => { if (saved.items[i]) r.dataset.id = saved.items[i].id; });
        U.$$('.item-row', this.itemsList).forEach((r) => { if (!r.querySelector('[name="item"]').value.trim() && this.itemsList.children.length > 1) r.remove(); });
        history.replaceState(null, '', `#/invoice-create?id=${encodeURIComponent(saved.id)}`);
        const title = this.root.querySelector('.page-title');
        if (title) title.textContent = `Edit ${saved.number}`;
        const statusSel = this.form.querySelector('[name="status"]');
        if (statusSel.value !== saved.status) statusSel.value = saved.status;
        this.paid = await Invoices.paidAmount(saved);
        this.updateTotals();
        this.syncSavedUI();
        UI.toast(`${saved.number} for ${saved.customer.name} was saved.`, { title: 'Invoice saved' });
        return saved;
      } catch (e) {
        UI.toast('The invoice could not be saved.', { type: 'error' });
        return null;
      } finally {
        btns.forEach((b) => UI.busy(b, false));
      }
    },

    syncSavedUI() {
      this.el.querySelector('.saved-actions').hidden = !this.savedId;
    },

    async current() {
      const d = await this.validate();
      if (!d) return null;
      return { ...d, id: this.savedId || undefined };
    },

    async action(act, btn) {
      if (act === 'save') return this.save();
      if (act === 'preview') { const d = await this.current(); if (d) Invoices.preview(d, { onEdit: () => this.form.querySelector('[name="c_name"]').focus() }); return; }
      if (act === 'print') { const d = await this.current(); if (d) Invoices.print(d); return; }
      if (act === 'pdf') {
        const d = await this.current();
        if (!d) return;
        UI.busy(btn, true, 'Preparing PDF');
        const ok = await Invoices.pdf(d);
        UI.busy(btn, false);
        if (ok) UI.toast(`${d.number} was downloaded.`, { title: 'PDF ready' });
        return;
      }
      if (act === 'more') {
        UI.menu(btn, [
          { label: 'Print', icon: 'print', onClick: () => this.action('print') },
          { label: 'Download PDF', icon: 'file-pdf', onClick: () => this.action('pdf', btn) },
          this.savedId ? { divider: true } : null,
          this.savedId ? { label: 'Duplicate', icon: 'clone', onClick: () => this.action('duplicate') } : null,
          this.savedId ? { label: 'Delete', icon: 'trash-can', danger: true, onClick: () => this.action('delete') } : null
        ]);
        return;
      }
      if (!this.savedId) return;
      if (this.dirty && act === 'duplicate') {
        const saved = await this.save();
        if (!saved) return;
      }
      if (act === 'duplicate') { this.dirty = false; return Invoices.duplicateAndOpen(this.savedId); }
      if (act === 'delete') {
        const ok = await Invoices.confirmDelete(this.savedId);
        if (ok) { this.dirty = false; KR.App.go('invoices'); }
      }
    },

    async refresh() {
      if (!this.el || !this.savedId || !document.contains(this.el)) return;
      const inv = await Invoices.get(this.savedId);
      if (!inv) return;
      this.paid = await Invoices.paidAmount(inv);
      const sel = this.form.querySelector('[name="status"]');
      if (!this.dirty && sel.value !== inv.status) sel.value = inv.status;
      this.updateTotals();
    },

    isDirty() { return !!(this.el && this.dirty); },
    destroy() { this.el = null; this.root = null; this.dirty = false; }
  };

  /* ======================================================================
     Invoice history page
     ====================================================================== */
  const HistoryPage = {
    async render(root, params) {
      this.root = root;
      this.state = { q: params.q || '', status: params.status || '', sort: 'newest' };
      const createBtn = U.el(`<a class="btn btn-primary" href="#/invoice-create">${UI.icon('file-circle-plus')}<span>Create invoice</span></a>`);
      root.appendChild(UI.pageHeader({ title: 'Invoices', subtitle: 'All invoices saved on this device.', actions: [createBtn] }));

      this.strip = U.el('<section class="stat-strip four"></section>');
      root.appendChild(this.strip);

      const tb = U.el(`
        <section class="panel filters">
          <div class="toolbar">
            <label class="search-input">${UI.icon('magnifying-glass')}<span class="sr-only">Search invoices</span>
              <input type="search" class="input" placeholder="Search number, customer, phone or item" value="${U.esc(this.state.q)}" autocomplete="off"></label>
            <div class="toolbar-end">
              <label class="sr-only" for="inv-f-status">Status</label>
              <select id="inv-f-status" class="input input-sm" name="status">${UI.options(STATUSES, this.state.status, 'All statuses')}</select>
              <label class="sr-only" for="inv-f-sort">Sort</label>
              <select id="inv-f-sort" class="input input-sm" name="sort">${UI.options([
                { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
                { value: 'due', label: 'Due date' }, { value: 'amount', label: 'Highest amount' }], this.state.sort)}</select>
            </div>
          </div>
        </section>`);
      root.appendChild(tb);
      tb.querySelector('input[type="search"]').addEventListener('input', U.debounce((e) => { this.state.q = e.target.value; this.refresh(); }, 250));
      tb.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { this.state[s.name] = s.value; this.refresh(); }));

      this.box = U.el('<section class="panel table-panel"></section>');
      root.appendChild(this.box);
      this.box.addEventListener('click', async (e) => {
        const row = e.target.closest('.inv-row');
        if (!row) return;
        const inv = await Invoices.get(row.dataset.id);
        if (!inv) return;
        const more = e.target.closest('[data-act="menu"]');
        if (more) { e.stopPropagation(); Invoices.rowMenu(more, inv); return; }
        const pdf = e.target.closest('[data-act="pdf"]');
        if (pdf) { e.stopPropagation(); Invoices.downloadPdf(inv.id, pdf); return; }
        Invoices.preview(inv);
      });
      this.box.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('inv-row')) {
          const inv = await Invoices.get(e.target.dataset.id);
          if (inv) Invoices.preview(inv);
        }
      });
      await this.refresh();
    },

    async refresh() {
      if (!this.root || !document.contains(this.root)) return;
      const all = await Invoices.all();
      const pay = await Invoices.paymentsMap();
      const s = this.state;

      // Summary (drafts and cancelled invoices are excluded)
      let invoiced = 0, received = 0, outstanding = 0, overdueAmt = 0, overdueCount = 0;
      all.forEach((inv) => {
        if (inv.status === 'draft' || inv.status === 'cancelled') return;
        const paid = Math.min(inv.total, Invoices.paidFor(inv, pay));
        invoiced += inv.total;
        received += paid;
        const bal = Math.max(0, inv.total - paid);
        outstanding += bal;
        if (Invoices.effectiveStatus(inv) === 'overdue') { overdueAmt += bal; overdueCount++; }
      });
      this.strip.innerHTML = `
        <div class="stat"><span class="stat-label">Total invoiced</span><strong class="stat-value">${U.esc(U.money(invoiced))}</strong><span class="stat-foot">Excludes drafts and cancelled</span></div>
        <div class="stat"><span class="stat-label">Paid</span><strong class="stat-value is-income">${U.esc(U.money(received))}</strong><span class="stat-foot">Invoices marked as paid</span></div>
        <div class="stat"><span class="stat-label">Outstanding</span><strong class="stat-value">${U.esc(U.money(outstanding))}</strong><span class="stat-foot">Still to be collected</span></div>
        <div class="stat"><span class="stat-label">Overdue</span><strong class="stat-value ${overdueCount ? 'is-expense' : ''}">${U.esc(U.money(overdueAmt))}</strong><span class="stat-foot">${overdueCount} ${overdueCount === 1 ? 'invoice' : 'invoices'} past due date</span></div>`;

      const q = s.q.trim().toLowerCase();
      let list = all.filter((inv) => {
        const eff = Invoices.effectiveStatus(inv);
        if (s.status && eff !== s.status && inv.status !== s.status) return false;
        if (!q) return true;
        const hay = [inv.number, inv.customer.name, inv.customer.phone, inv.customer.email, U.fmtDate(inv.date), String(inv.total), ...inv.items.map((i) => i.item)].join(' ').toLowerCase();
        return q.split(/\s+/).every((tok) => hay.includes(tok));
      });
      if (s.sort === 'oldest') list = list.slice().reverse();
      else if (s.sort === 'due') list = list.slice().sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
      else if (s.sort === 'amount') list = list.slice().sort((a, b) => b.total - a.total);

      if (!all.length) {
        this.box.innerHTML = '';
        this.box.appendChild(UI.empty({ icon: 'file-invoice', title: 'No invoices yet.', text: 'Create a professional invoice, print it or download it as a PDF.', actionLabel: 'Create first invoice', actionIcon: 'file-circle-plus', onAction: () => KR.App.go('invoice-create') }));
        return;
      }
      if (!list.length) {
        this.box.innerHTML = '';
        this.box.appendChild(UI.empty({ icon: 'filter-circle-xmark', title: 'No invoices match your search.', text: 'Try another name, number or status.' }));
        return;
      }

      this.box.innerHTML = `
        <div class="table-scroll">
          <table class="data-table inv-table">
            <thead><tr><th scope="col">Invoice number</th><th scope="col">Customer</th><th scope="col">Date</th><th scope="col">Due date</th><th scope="col" class="num">Amount</th><th scope="col">Status</th><th scope="col" class="num"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${list.map((inv) => {
              const eff = Invoices.effectiveStatus(inv);
              const paid = Invoices.paidFor(inv, pay);
              const bal = Math.max(0, U.round(inv.total - paid));
              return `
              <tr class="inv-row" data-id="${U.esc(inv.id)}" tabindex="0" aria-label="${U.esc(`${inv.number}, ${inv.customer.name}, ${U.money(inv.total)}, ${STATUS_LABEL[eff]}`)}">
                <td class="i-num"><strong>${U.esc(inv.number)}</strong> ${inv.isDemo ? UI.demoBadge() : ''}</td>
                <td class="i-cust">${U.esc(inv.customer.name)}${inv.customer.phone ? `<span class="sub">${U.esc(inv.customer.phone)}</span>` : ''}</td>
                <td class="i-date"><span class="m-only">Issued </span>${U.esc(U.fmtDate(inv.date))}</td>
                <td class="i-due ${eff === 'overdue' ? 'is-expense' : ''}"><span class="m-only">Due </span>${U.esc(U.fmtDate(inv.dueDate))}</td>
                <td class="i-amt num"><strong>${U.esc(U.money(inv.total))}</strong>${paid > 0 && bal > 0 ? `<span class="sub">Balance ${U.esc(U.money(bal))}</span>` : ''}</td>
                <td class="i-status">${Invoices.badge(eff)}</td>
                <td class="i-act num">
                  <button type="button" class="icon-btn hide-mobile" data-act="pdf" aria-label="Download PDF" data-tip="Download PDF">${UI.icon('file-pdf')}</button>
                  <button type="button" class="icon-btn" data-act="menu" aria-label="Invoice actions" aria-haspopup="menu" data-tip="Actions">${UI.icon('ellipsis-vertical')}</button>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;
    },

    destroy() { this.root = null; }
  };

  KR.Invoices = Invoices;
  KR.Pages = KR.Pages || {};
  KR.Pages['invoice-create'] = GeneratorPage;
  KR.Pages.invoices = HistoryPage;
})(window.KR = window.KR || {});
