/* ==========================================================================
   THE CURRENT INVESTMENT — utils.js
   Formatting, dates, DOM helpers, hashing, event bus.
   ========================================================================== */
(function (KR) {
  'use strict';

  const U = {};

  /* ---------- DOM ---------- */
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  U.esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

  /** Create a DOM element from an HTML string (first element). */
  U.el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  };

  U.uid = () => {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const r = () => Math.random().toString(16).slice(2, 10);
    return `${Date.now().toString(16)}-${r()}-${r()}`;
  };

  U.debounce = (fn, ms = 250) => {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  U.isTypingTarget = (el) =>
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

  /* ---------- Event bus ---------- */
  const bus = new EventTarget();
  U.on = (name, fn) => {
    const h = (e) => fn(e.detail);
    bus.addEventListener(name, h);
    return () => bus.removeEventListener(name, h);
  };
  U.emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

  /* ---------- Numbers & money ---------- */
  const ZERO_DECIMAL = ['TZS', 'UGX', 'RWF', 'BIF', 'JPY', 'KRW'];
  U.currency = () => (KR.settings && KR.settings.currency) || 'TZS';
  U.decimals = () => (ZERO_DECIMAL.includes(U.currency().toUpperCase()) ? 0 : 2);

  U.round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  U.num = (n, decimals) => {
    const d = decimals == null ? U.decimals() : decimals;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    }).format(Math.abs(Number(n) || 0));
  };

  /**
   * Format money. opts.sign: '+'/'-' prefix for signed display.
   * TZS 1,250,000   |   + TZS 300,000   |   - TZS 75,000
   */
  U.money = (n, opts = {}) => {
    const v = Number(n) || 0;
    const body = `${U.currency()} ${U.num(v)}`;
    if (opts.signed) {
      if (v === 0) return body;
      return `${v > 0 ? '+' : '-'} ${body}`;
    }
    return v < 0 ? `- ${body}` : body;
  };

  U.moneyTx = (tx) => `${tx.type === 'income' ? '+' : '-'} ${U.currency()} ${U.num(tx.amount)}`;

  /** Compact axis labels: 1.2M, 450K */
  U.compact = (n) => {
    const v = Math.abs(n);
    const s = n < 0 ? '-' : '';
    if (v >= 1e9) return s + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (v >= 1e6) return s + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return s + (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return s + v;
  };

  U.parseAmount = (str) => {
    if (typeof str === 'number') return str;
    const clean = String(str || '').replace(/[^\d.]/g, '');
    if (!clean) return NaN;
    const parts = clean.split('.');
    const normalized = parts[0] + (parts.length > 1 ? '.' + parts.slice(1).join('') : '');
    return U.round(parseFloat(normalized));
  };

  U.formatAmountInput = (n) => {
    if (n === '' || n == null || isNaN(n)) return '';
    const d = U.decimals();
    const fixed = Number(n).toFixed(d);
    const [i, dec] = fixed.split('.');
    const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d && dec && Number(dec) !== 0 ? `${int}.${dec}` : int;
  };

  U.pct = (part, total) => (total > 0 ? (part / total) * 100 : 0);
  U.pctLabel = (v) => `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;

  /* ---------- Dates (always local, ISO YYYY-MM-DD) ---------- */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
  U.MONTHS = MONTHS;
  U.MONTHS_SHORT = MONTHS_SHORT;

  const pad = (n) => String(n).padStart(2, '0');
  U.toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  U.todayISO = () => U.toISO(new Date());

  U.parseISO = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  U.isValidISO = (s) => {
    const d = U.parseISO(s);
    if (!d || isNaN(d)) return false;
    const y = d.getFullYear();
    return U.toISO(d) === s && y >= 1990 && y <= 2100;
  };

  U.addDays = (iso, n) => {
    const d = U.parseISO(iso);
    d.setDate(d.getDate() + n);
    return U.toISO(d);
  };

  U.fmtDate = (iso) => {
    const d = U.parseISO(iso);
    if (!d) return '';
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  };

  U.fmtDateTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${U.fmtDate(U.toISO(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  U.monthKey = (iso) => String(iso || '').slice(0, 7);
  U.currentMonthKey = () => U.monthKey(U.todayISO());

  U.monthLabel = (key) => {
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  };
  U.monthShort = (key, withYear = true) => {
    const [y, m] = key.split('-').map(Number);
    return withYear ? `${MONTHS_SHORT[m - 1]} ${y}` : MONTHS_SHORT[m - 1];
  };

  U.addMonths = (key, n) => {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };

  U.daysInMonth = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  };

  U.monthRange = (key) => ({
    start: `${key}-01`,
    end: `${key}-${pad(U.daysInMonth(key))}`
  });

  U.isValidMonthKey = (k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(k || ''));

  /* ---------- Files ---------- */
  U.download = (filename, content, mime = 'text/plain') => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  U.readFileText = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });

  U.fileSlug = (s) => String(s || '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  /** Load an image and return a PNG data URL (resized to maxSize). Rejects on CORS failure. */
  U.imageToDataURL = (src, maxSize = 512) =>
    new Promise((res, rej) => {
      const img = new Image();
      if (!/^data:/.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          res({ data: c.toDataURL('image/png'), width: w, height: h });
        } catch (e) {
          rej(e);
        }
      };
      img.onerror = () => rej(new Error('Image could not be loaded'));
      img.src = src;
    });

  U.fileToDataURL = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });

  /* ---------- Script loader (for lazily loaded CDN libraries) ---------- */
  const scripts = {};
  U.loadScript = (src) => {
    if (!scripts[src]) {
      scripts[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => res();
        s.onerror = () => {
          delete scripts[src];
          s.remove();
          rej(new Error('Could not load ' + src));
        };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  };

  /* ---------- CSV ---------- */
  U.csvCell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  /* ---------- SHA-256 (pure JS; works without secure context) ---------- */
  U.sha256 = (input) => {
    const ascii = unescape(encodeURIComponent(String(input)));
    const rightRotate = (v, a) => (v >>> a) | (v << (32 - a));
    const maxWord = Math.pow(2, 32);
    let result = '';
    const words = [];
    const bitLength = ascii.length * 8;
    let hash = [];
    const k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    let str = ascii + '\x80';
    while ((str.length % 64) - 56) str += '\x00';
    for (let i = 0; i < str.length; i++) {
      words[i >> 2] |= str.charCodeAt(i) << (((3 - i) % 4) * 8);
    }
    words[words.length] = (bitLength / maxWord) | 0;
    words[words.length] = bitLength;
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15];
        const w2 = w[i - 2];
        const a = hash[0];
        const e = hash[4];
        const temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0);
        const temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) {
      for (let j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  };

  KR.U = U;
})(window.KR = window.KR || {});
