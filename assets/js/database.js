/* ==========================================================================
   THE CURRENT INVESTMENT — database.js
   IndexedDB storage: invoices, invoiceItems, settings
   ========================================================================== */
(function (KR) {
  'use strict';

  const DB_NAME = 'the_current_investment_invoices';
  const DB_VERSION = 1;
  const STORES = ['invoices', 'invoiceItems', 'settings'];

  const DEFAULT_LOGO = 'assets/img/logo.png';

  const DEFAULT_SETTINGS = {
    businessName: 'THE CURRENT INVESTMENT',
    appName: 'THE CURRENT INVESTMENT',
    businessTagline: 'Electrical Solution',
    businessPhone: '+255 783 207 104',
    businessEmail: 'thecurrentinvestment@gmail.com',
    businessAddress: 'Kinondoni Biafra, Dar es Salaam',
    tin: '178106910',
    logoUrl: DEFAULT_LOGO,
    logoData: '',
    logoSource: 'default',
    watermark: true,
    invoicePrefix: 'TCI-INV',
    currency: 'TZS',
    defaultDueDays: 30,
    defaultTaxRate: 18,
    taxLabel: 'VAT',
    invoiceThankYou: 'Thank you for your business.',
    bankName: '',
    accountName: 'SAMWEL HANINGTON KIHARATA',
    accountNumber: '0193894001',
    mobileMoneyNumber: '',
    paymentInstructions: '',
    invoiceSeq: {}
  };

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('This browser does not support IndexedDB storage.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('invoices')) {
          const s = db.createObjectStore('invoices', { keyPath: 'id' });
          s.createIndex('number', 'number');
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('invoiceItems')) {
          const s = db.createObjectStore('invoiceItems', { keyPath: 'id' });
          s.createIndex('invoiceId', 'invoiceId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Storage is blocked by another open tab. Close other tabs and reload.'));
    });
    return dbPromise;
  }

  const promisify = (req) =>
    new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });

  async function withStore(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      const r = fn(store);
      if (r && typeof r.onsuccess !== 'undefined') {
        r.onsuccess = () => { result = r.result; };
      }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage operation aborted'));
    });
  }

  const DB = {
    STORES,
    DEFAULT_SETTINGS,
    DEFAULT_LOGO,

    open,

    getAll: (store) => withStore(store, 'readonly', (s) => s.getAll()),
    get: (store, key) => withStore(store, 'readonly', (s) => s.get(key)),
    put: (store, value) => withStore(store, 'readwrite', (s) => s.put(value)),
    del: (store, key) => withStore(store, 'readwrite', (s) => s.delete(key)),
    count: (store) => withStore(store, 'readonly', (s) => s.count()),

    async getAllByIndex(store, index, value) {
      const db = await open();
      const t = db.transaction(store, 'readonly');
      return promisify(t.objectStore(store).index(index).getAll(value));
    },

    /**
     * Run several operations atomically across stores.
     * ops: [{ store, op: 'put'|'delete'|'clear', value?, key? }]
     */
    async bulk(ops) {
      if (!ops.length) return;
      const db = await open();
      const names = [...new Set(ops.map((o) => o.store))];
      return new Promise((resolve, reject) => {
        const t = db.transaction(names, 'readwrite');
        ops.forEach((o) => {
          const s = t.objectStore(o.store);
          if (o.op === 'put') s.put(o.value);
          else if (o.op === 'delete') s.delete(o.key);
          else if (o.op === 'clear') s.clear();
        });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Storage operation aborted'));
      });
    },

    /* ---------- Settings ---------- */
    settings: {
      async getAll() {
        const rows = await DB.getAll('settings');
        const out = { ...DEFAULT_SETTINGS };
        rows.forEach((r) => {
          if (r.key in DEFAULT_SETTINGS || r.key.startsWith('_')) out[r.key] = r.value;
        });
        return out;
      },
      async get(key, fallback) {
        const row = await DB.get('settings', key);
        return row ? row.value : fallback;
      },
      set: (key, value) => DB.put('settings', { key, value }),
      setMany: (obj) =>
        DB.bulk(Object.keys(obj).map((key) => ({ store: 'settings', op: 'put', value: { key, value: obj[key] } })))
    },

    /* ---------- Export / restore ---------- */
    async exportAll() {
      const [invoices, invoiceItems, settings] = await Promise.all(STORES.map((s) => DB.getAll(s)));
      return { invoices, invoiceItems, settings };
    },

    async replaceAll(data) {
      const ops = [];
      STORES.forEach((s) => ops.push({ store: s, op: 'clear' }));
      STORES.forEach((s) => (data[s] || []).forEach((value) => ops.push({ store: s, op: 'put', value })));
      ops.push({ store: 'settings', op: 'put', value: { key: '_initialized', value: true } });
      await DB.bulk(ops);
    },

    async mergeAll(data) {
      const existing = await DB.exportAll();
      const ops = [];
      ['invoices', 'invoiceItems'].forEach((s) => {
        const ids = new Set(existing[s].map((r) => r.id));
        (data[s] || []).forEach((value) => {
          if (!ids.has(value.id)) ops.push({ store: s, op: 'put', value });
        });
      });
      await DB.bulk(ops);
      return ops.length;
    },

    /* ---------- First launch ---------- */
    async init() {
      await open();
      const initialized = await DB.settings.get('_initialized', false);
      if (initialized) return;
      const ops = Object.keys(DEFAULT_SETTINGS).map((key) => ({ store: 'settings', op: 'put', value: { key, value: DEFAULT_SETTINGS[key] } }));
      ops.push({ store: 'settings', op: 'put', value: { key: '_initialized', value: true } });
      await DB.bulk(ops);
    }
  };

  KR.DB = DB;
})(window.KR = window.KR || {});
