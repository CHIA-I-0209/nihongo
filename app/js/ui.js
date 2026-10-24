// 共用的狀態與小工具
import { esc } from './furigana.js';

export const APP_VERSION = '2.0.0';
export const DEFAULT_SETTINGS = { newLimit: 15, furigana: true };
export const POS_LABEL = { noun: '名詞', verb: '動詞', 'i-adj': 'い形容詞', 'na-adj': 'な形容詞', adv: '副詞', expr: '表現' };

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  content: null,
  exercises: null,
  reviews: {},
  session: null,
  syncing: false,
  lastSyncError: '',
};

export const $view = document.getElementById('view');

/* ---------- 共用工具 ---------- */

export const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let toastTimer;
export function toast(msg, { action, onAction, sticky = false } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; onAction(); };
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

export function relativeTime(ts) {
  if (!ts) return '從未';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

let jaVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  jaVoice = voices.find((v) => v.lang === 'ja-JP' && /Kyoko|O-ren|Google/.test(v.name))
    || voices.find((v) => v.lang && v.lang.startsWith('ja')) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}
export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (jaVoice) u.voice = jaVoice;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}
export const speakBtn = (text) => ('speechSynthesis' in window && text
  ? `<button type="button" class="speak" data-speak="${esc(text)}" aria-label="播放發音"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg></button>`
  : '');

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-speak]');
  if (b) speak(b.dataset.speak);
});
