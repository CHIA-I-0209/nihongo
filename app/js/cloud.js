// Supabase 連線：登入（Auth API）與資料存取（REST API）
// 直接用 fetch，不需要額外套件。
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { db } from './db.js';
import { replay } from './fsrs.js';

const BASE = String(SUPABASE_URL || '').replace(/\/+$/, '');
const PAGE = 1000; // Supabase 預設每次最多回傳 1000 列

export const isConfigured = () => /^https?:\/\/.+/.test(BASE) && Boolean(SUPABASE_KEY);

export class CloudError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/* ---------- 欄位對應：App（camelCase）↔ 資料庫（snake_case） ---------- */

export const TABLES = {
  words: {
    toDb: (w) => ({
      id: w.id, kanji: w.kanji || '', kana: w.kana, meaning: w.meaning || '', pos: w.pos || 'noun',
      verb_class: w.pos === 'verb' ? (w.verbClass || '') : '', jlpt: Number(w.jlpt) || 5,
      false_friend: Boolean(w.falseFriend), note: w.note || '', sort: Number(w.sort) || 0,
    }),
    fromDb: (r) => ({
      id: r.id, kanji: r.kanji, kana: r.kana, meaning: r.meaning, pos: r.pos, verbClass: r.verb_class,
      jlpt: r.jlpt, falseFriend: r.false_friend, note: r.note, sort: r.sort,
    }),
  },
  grammar: {
    toDb: (g) => ({
      id: g.id, title: g.title, pattern: g.pattern || '', meaning: g.meaning || '',
      explanation: g.explanation || '', jlpt: Number(g.jlpt) || 5, sort: Number(g.sort) || 0,
    }),
    fromDb: (r) => ({
      id: r.id, title: r.title, pattern: r.pattern, meaning: r.meaning, explanation: r.explanation, jlpt: r.jlpt, sort: r.sort,
    }),
  },
  sentences: {
    toDb: (s) => ({
      id: s.id, jp: s.jp, zh: s.zh || '', words: s.words || '', grammar: s.grammar || '', sort: Number(s.sort) || 0,
    }),
    fromDb: (r) => ({ id: r.id, jp: r.jp, zh: r.zh, words: r.words, grammar: r.grammar, sort: r.sort }),
  },
};

/* ---------- 登入狀態 ---------- */

let session = null;

export async function loadSession() {
  session = await db.get('session', null);
  return session;
}

export const currentUser = () => (session ? session.user : null);

async function saveSession(data) {
  session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    user: { id: data.user?.id, email: data.user?.email },
  };
  await db.set('session', session);
  return session;
}

const AUTH_MESSAGES = {
  invalid_credentials: '電子郵件或密碼不正確',
  email_not_confirmed: '還沒確認電子郵件，請到信箱點確認連結後再登入',
  user_already_exists: '這個電子郵件已經註冊過了，請直接登入',
  email_exists: '這個電子郵件已經註冊過了，請直接登入',
  weak_password: '密碼太簡單，至少要 6 個字元',
  over_email_send_rate_limit: '寄信次數太頻繁，請過一小時再試',
  over_request_rate_limit: '嘗試次數太多，請稍後再試',
  validation_failed: '電子郵件格式不正確',
  email_address_invalid: '電子郵件格式不正確',
  signup_disabled: '這個專案沒有開放註冊',
  same_password: '新密碼不能和舊密碼相同',
};

function authMessage(data, status) {
  const code = data.error_code || data.code || data.error;
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  const text = data.msg || data.message || data.error_description || '';
  if (/invalid login credentials/i.test(text)) return AUTH_MESSAGES.invalid_credentials;
  if (/not confirmed/i.test(text)) return AUTH_MESSAGES.email_not_confirmed;
  if (/already registered/i.test(text)) return AUTH_MESSAGES.user_already_exists;
  if (/at least 6/i.test(text)) return AUTH_MESSAGES.weak_password;
  return text ? `登入服務回報：${text}` : `登入服務錯誤（${status}）`;
}

async function authCall(path, body, { method = 'POST', token } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/auth/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new CloudError('連不上 Supabase，請確認網路', 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudError(authMessage(data, res.status), data.error_code || data.code || res.status);
  return data;
}

const redirectUrl = () => location.href.split('#')[0];

/** 註冊。回傳 { signedIn: true } 或 { needsConfirm: true } */
export async function signUp(email, password) {
  const data = await authCall(`signup?redirect_to=${encodeURIComponent(redirectUrl())}`, { email, password });
  if (data.access_token) { await saveSession(data); return { signedIn: true }; }
  // 開啟「Confirm email」時，已註冊的信箱也會回傳假的使用者（identities 為空）
  if (data.identities && data.identities.length === 0) {
    throw new CloudError(AUTH_MESSAGES.user_already_exists, 'user_already_exists');
  }
  return { needsConfirm: true };
}

export async function signIn(email, password) {
  const data = await authCall('token?grant_type=password', { email, password });
  await saveSession(data);
}

export async function sendPasswordReset(email) {
  await authCall(`recover?redirect_to=${encodeURIComponent(redirectUrl())}`, { email });
}

export async function updatePassword(password) {
  await ensureFreshToken();
  await authCall('user', { password }, { method: 'PUT', token: session.accessToken });
}

export async function signOut() {
  const s = session;
  session = null;
  await db.set('session', null);
  if (s && navigator.onLine) {
    authCall('logout', null, { token: s.accessToken }).catch(() => {});
  }
}

let refreshing = null;
async function refreshToken() {
  if (!session) throw new CloudError('請重新登入', 'signed_out');
  if (!refreshing) {
    refreshing = authCall('token?grant_type=refresh_token', { refresh_token: session.refreshToken })
      .then(saveSession)
      .catch(async (e) => {
        if (e.code !== 'network') { session = null; await db.set('session', null); }
        throw e.code === 'network' ? e : new CloudError('登入已過期，請重新登入', 'signed_out');
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function ensureFreshToken() {
  if (!session) throw new CloudError('請重新登入', 'signed_out');
  if (Date.now() > session.expiresAt - 60_000) await refreshToken();
}

/**
 * 處理 Supabase 寄出的連結（確認信箱、重設密碼）
 * 連結會把 #access_token=…&type=… 帶回 App。回傳 type 或 null
 */
export async function handleAuthRedirect() {
  const hash = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error_description)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  history.replaceState(null, '', redirectUrl());
  if (p.get('error_description')) {
    const message = p.get('error_code') === 'otp_expired'
      ? '信裡的連結已經過期或用過了，請重新操作一次'
      : `連結無法使用：${p.get('error_description').replace(/\+/g, ' ')}`;
    return { type: 'error', message };
  }
  session = { accessToken: p.get('access_token'), refreshToken: p.get('refresh_token'), expiresAt: 0, user: {} };
  try {
    const user = await authCall('user', null, { method: 'GET', token: session.accessToken });
    await saveSession({
      access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
      expires_in: p.get('expires_in'), user,
    });
  } catch (e) {
    session = null;
    return { type: 'error', message: '連結已失效，請重新操作一次' };
  }
  return { type: p.get('type') || 'signin' };
}

/* ---------- REST API ---------- */

async function rest(path, { method = 'GET', body, prefer, retried = false } = {}) {
  await ensureFreshToken();
  let res;
  try {
    res = await fetch(`${BASE}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new CloudError('連不上 Supabase，請確認網路', 'network');
  }
  if (res.status === 401 && !retried) {
    await refreshToken();
    return rest(path, { method, body, prefer, retried: true });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.code === '42P01' || data.code === 'PGRST205') {
      throw new CloudError('資料庫裡找不到資料表，請先在 Supabase 執行 schema.sql', data.code);
    }
    if (res.status === 401 || res.status === 403) throw new CloudError('沒有權限存取資料，請重新登入', 'signed_out');
    throw new CloudError(`資料庫錯誤：${data.message || res.status}`, data.code || res.status);
  }
  if (res.status === 204 || method !== 'GET') return null;
  return res.json();
}

async function fetchAll(table, query) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(`${table}?${query}&limit=${PAGE}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/* ---------- 教材 ---------- */

export async function fetchContent() {
  const [words, grammar, sentences] = await Promise.all(
    ['words', 'grammar', 'sentences'].map((t) => fetchAll(t, 'select=*&order=sort.asc,id.asc')),
  );
  return {
    words: words.map(TABLES.words.fromDb),
    grammar: grammar.map(TABLES.grammar.fromDb),
    sentences: sentences.map(TABLES.sentences.fromDb),
  };
}

export async function saveItems(table, items) {
  const rows = items.map(TABLES[table].toDb);
  for (let i = 0; i < rows.length; i += 500) {
    await rest(`${table}?on_conflict=user_id,id`, {
      method: 'POST', body: rows.slice(i, i + 500), prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
}

export async function deleteItem(table, id) {
  await rest(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

/** 新帳號第一次登入時，把示範教材放進雲端 */
export async function seedIfEmpty(seed) {
  const content = await fetchContent();
  if (content.words.length || content.grammar.length || content.sentences.length) return false;
  const withSort = (list) => list.map((x, i) => ({ ...x, sort: (i + 1) * 10 }));
  await saveItems('words', withSort(seed.words));
  await saveItems('grammar', withSort(seed.grammar));
  await saveItems('sentences', withSort(seed.sentences));
  return true;
}

/* ---------- 學習紀錄 ---------- */

async function pushLogs() {
  const pending = await db.unsyncedLogs();
  for (let i = 0; i < pending.length; i += 500) {
    const batch = pending.slice(i, i + 500);
    await rest('review_logs?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: batch.map((l) => ({
        id: l.id, exercise_id: l.exerciseId, rating: l.rating, reviewed_at: l.reviewedAt, device: l.device || '',
      })),
    });
    await db.putLogs(batch.map((l) => ({ ...l, synced: 1 })));
  }
  return pending.length;
}

async function pullLogs() {
  let cursor = await db.get('logsCursor', 0);
  const incoming = [];
  for (;;) {
    const rows = await rest(`review_logs?select=seq,id,exercise_id,rating,reviewed_at,device&seq=gt.${cursor}&order=seq.asc&limit=${PAGE}`);
    rows.forEach((r) => incoming.push({
      id: r.id, exerciseId: r.exercise_id, rating: r.rating, reviewedAt: Number(r.reviewed_at), device: r.device, synced: 1,
    }));
    if (rows.length) cursor = rows[rows.length - 1].seq;
    if (rows.length < PAGE) break;
  }
  const local = await db.allLogs();
  const known = new Set(local.map((l) => l.id));
  const fresh = incoming.filter((l) => !known.has(l.id));
  if (fresh.length) {
    await db.putLogs(fresh);
    const affected = new Set(fresh.map((l) => l.exerciseId));
    const grouped = {};
    local.concat(fresh).forEach((l) => { if (affected.has(l.exerciseId)) (grouped[l.exerciseId] ||= []).push(l); });
    await db.putReviews(Object.entries(grouped).map(([id, logs]) => replay(id, logs)));
  }
  await db.set('logsCursor', cursor);
  return fresh.length;
}

export async function deleteAllLogs() {
  await rest('review_logs?seq=gt.0', { method: 'DELETE', prefer: 'return=minimal' });
}

/** 完整同步：上傳紀錄 → 下載其他裝置的紀錄 → 更新教材 */
export async function syncAll() {
  const pushed = await pushLogs();
  const pulled = await pullLogs();
  const content = await fetchContent();
  const prev = await db.get('content');
  const changed = !prev || JSON.stringify([prev.words, prev.grammar, prev.sentences])
    !== JSON.stringify([content.words, content.grammar, content.sentences]);
  if (changed) await db.set('content', { ...content, updatedAt: Date.now() });
  await db.set('lastSync', Date.now());
  return { pushed, pulled, contentUpdated: changed && Boolean(prev) };
}
