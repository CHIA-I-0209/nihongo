// IndexedDB 精簡封裝
// stores:
//   kv       { key, value }        教材、設定、同步狀態
//   reviews  { exerciseId, ... }   每題的 FSRS 狀態
//   logs     { id, exerciseId, rating, reviewedAt, device, synced }

const DB_NAME = 'nihongo';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'exerciseId' });
      if (!db.objectStoreNames.contains('logs')) {
        const logs = db.createObjectStore('logs', { keyPath: 'id' });
        logs.createIndex('synced', 'synced');
        logs.createIndex('exerciseId', 'exerciseId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  async get(key, fallback = undefined) {
    const row = await tx(['kv'], 'readonly', (t) => wrap(t.objectStore('kv').get(key)));
    return row ? row.value : fallback;
  },
  set(key, value) {
    return tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').put({ key, value }); });
  },
  allReviews() {
    return tx(['reviews'], 'readonly', (t) => wrap(t.objectStore('reviews').getAll()));
  },
  putReviews(list) {
    return tx(['reviews'], 'readwrite', (t) => {
      const s = t.objectStore('reviews');
      list.forEach((r) => s.put(r));
    });
  },
  /** 一次寫入答題紀錄和新的排程狀態 */
  recordAnswer(log, review) {
    return tx(['logs', 'reviews'], 'readwrite', (t) => {
      t.objectStore('logs').put(log);
      t.objectStore('reviews').put(review);
    });
  },
  allLogs() {
    return tx(['logs'], 'readonly', (t) => wrap(t.objectStore('logs').getAll()));
  },
  unsyncedLogs() {
    return tx(['logs'], 'readonly', (t) => wrap(t.objectStore('logs').index('synced').getAll(0)));
  },
  putLogs(list) {
    return tx(['logs'], 'readwrite', (t) => {
      const s = t.objectStore('logs');
      list.forEach((l) => s.put(l));
    });
  },
  /** 登出時清掉這個帳號的所有本機資料（保留裝置設定） */
  async clearAccountData() {
    await tx(['kv', 'logs', 'reviews'], 'readwrite', async (t) => {
      t.objectStore('logs').clear();
      t.objectStore('reviews').clear();
      const kv = t.objectStore('kv');
      const keys = await wrap(kv.getAllKeys());
      keys.filter((k) => k !== 'settings').forEach((k) => kv.delete(k));
    });
  },
  async clearProgress() {
    await tx(['logs', 'reviews'], 'readwrite', (t) => {
      t.objectStore('logs').clear();
      t.objectStore('reviews').clear();
    });
  },
};

/** 請求瀏覽器不要自動清除資料 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      return already || (await navigator.storage.persist());
    }
  } catch (e) { /* 忽略 */ }
  return false;
}
