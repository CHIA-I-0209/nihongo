// FSRS-4.5 間隔重複排程（精簡實作）
// 評分：1 = 忘記, 2 = 困難, 3 = 記得, 4 = 簡單

const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367,
  1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY = 86400000;
const RETENTION = 0.9;
const MAX_INTERVAL = 3650;
const RELEARN_MS = 10 * 60 * 1000;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays, stability) {
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

function initDifficulty(g) { return clamp(W[4] - (g - 3) * W[5], 1, 10); }

function nextDifficulty(d, g) {
  const d1 = d - W[6] * (g - 3);
  return clamp(W[7] * initDifficulty(3) + (1 - W[7]) * d1, 1, 10);
}

function recallStability(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
}

function forgetStability(d, s, r) {
  return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
}

function intervalDays(s) {
  const ivl = (s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, MAX_INTERVAL);
}

export function newState(exerciseId) {
  return { exerciseId, state: 'new', stability: 0, difficulty: 0, due: 0, lastReview: 0, reps: 0, lapses: 0 };
}

/** 依評分計算下一個狀態（不修改原物件） */
export function schedule(prev, rating, now = Date.now()) {
  const c = { ...prev };
  if (c.state === 'new' || !c.lastReview) {
    c.stability = W[rating - 1];
    c.difficulty = initDifficulty(rating);
  } else {
    const elapsed = Math.max(0, (now - c.lastReview) / DAY);
    const r = retrievability(elapsed, c.stability);
    c.difficulty = nextDifficulty(c.difficulty, rating);
    c.stability = rating === 1
      ? forgetStability(c.difficulty, c.stability, r)
      : recallStability(c.difficulty, c.stability, r, rating);
  }
  c.stability = Math.max(c.stability, 0.1);
  c.reps += 1;
  if (rating === 1) {
    if (c.state !== 'new') c.lapses += 1;
    c.state = 'relearning';
    c.due = now + RELEARN_MS;
  } else {
    c.state = 'review';
    c.due = now + intervalDays(c.stability) * DAY;
  }
  c.lastReview = now;
  return c;
}

/** 從答題紀錄重算狀態（同步合併時用） */
export function replay(exerciseId, logs) {
  return logs
    .slice()
    .sort((a, b) => a.reviewedAt - b.reviewedAt)
    .reduce((st, l) => schedule(st, l.rating, l.reviewedAt), newState(exerciseId));
}

/** 顯示用：這個評分下次大約多久後出現 */
export function previewInterval(prev, rating, now = Date.now()) {
  const next = schedule(prev, rating, now);
  const ms = next.due - now;
  if (ms < DAY) return `${Math.round(ms / 60000)} 分鐘`;
  const d = Math.round(ms / DAY);
  if (d < 30) return `${d} 天`;
  if (d < 365) return `${Math.round(d / 30)} 個月`;
  return `${(d / 365).toFixed(1)} 年`;
}
