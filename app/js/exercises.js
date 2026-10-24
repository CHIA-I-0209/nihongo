// 從教材自動產生題目
import { conjugate, formsFor } from './conjugate.js';
import { parseJp, surface, reading } from './furigana.js';
import { hasKanji, normalizeAnswer } from './kana.js';

export const PARTICLES = ['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も'];

export const TYPE_LABEL = {
  reading: '讀音',
  recall: '中 → 日',
  conj: '活用',
  particle: '助詞',
  grammar: '文法',
};

/**
 * 回傳 { list, byId }
 * 每題：{ id, type, order, requires?, word?, form?, sentence?, tokens?, blankIndex?, grammar?, answers, display }
 */
export function buildExercises(content) {
  const list = [];
  const words = content.words || [];
  const grammar = content.grammar || [];
  const sentences = content.sentences || [];
  const wordById = Object.fromEntries(words.map((w) => [w.id, w]));
  const grammarById = Object.fromEntries(grammar.map((g) => [g.id, g]));
  const wordOrder = {};

  words.forEach((w, i) => {
    if (!w.id || !w.kana) return;
    const base = i * 10;
    wordOrder[w.id] = base;
    const readingId = `w:${w.id}:reading`;
    const recallId = `w:${w.id}:recall`;
    if (w.kanji && hasKanji(w.kanji)) {
      list.push({ id: readingId, type: 'reading', order: base, word: w, answers: [w.kana], display: w.kana });
    }
    list.push({
      id: recallId, type: 'recall', order: base + 1, word: w,
      answers: [w.kana, w.kanji].filter(Boolean), display: w.kanji || w.kana,
    });
    formsFor(w).forEach((f, j) => {
      const r = conjugate(w, f.key);
      if (!r) return;
      list.push({
        id: `c:${w.id}:${f.key}`, type: 'conj', order: base + 2 + j, requires: recallId,
        word: w, form: f, answers: r.answers, display: r.display, kana: r.kana,
      });
    });
  });

  sentences.forEach((s, i) => {
    if (!s.id || !s.jp) return;
    const tokens = parseJp(s.jp);
    const ids = String(s.words || '').split(',').map((x) => x.trim()).filter(Boolean);
    const after = Math.max(-1, ...ids.map((id) => wordOrder[id] ?? -1));
    const base = (after >= 0 ? after + 5 : words.length * 10 + i * 10) + i * 0.01;
    const g = grammarById[String(s.grammar || '').trim()];
    tokens.filter((t) => t.t === 'blank').forEach((b) => {
      if (b.kind === 'p') {
        const ans = surface(b.tokens);
        list.push({
          id: `s:${s.id}:p${b.index}`, type: 'particle', order: base + 0.1 * b.index, sentence: s, tokens,
          blankIndex: b.index, answers: [ans], display: ans, grammar: g,
          choices: PARTICLES.includes(ans) ? PARTICLES : [...PARTICLES, ans],
        });
      } else {
        const sf = surface(b.tokens);
        const rd = reading(b.tokens);
        list.push({
          id: `s:${s.id}:g${b.index}`, type: 'grammar', order: base + 3, sentence: s, tokens,
          blankIndex: b.index, grammar: g, answers: [...new Set([sf, rd])], display: sf, kana: rd,
        });
      }
    });
  });

  list.sort((a, b) => a.order - b.order);
  return { list, byId: Object.fromEntries(list.map((e) => [e.id, e])), wordById, grammarById };
}

export function checkAnswer(ex, input) {
  const got = normalizeAnswer(input);
  if (!got) return false;
  return ex.answers.some((a) => normalizeAnswer(a) === got);
}

/**
 * 組出今天的題目佇列：到期的複習 + 新題（受每日上限限制）
 */
export function buildQueue(exercises, reviewsById, { newLimit, newDoneToday, now = Date.now() }) {
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const due = [];
  const fresh = [];
  for (const ex of exercises.list) {
    const r = reviewsById[ex.id];
    if (r && r.state !== 'new') {
      if (r.due <= endOfDay.getTime()) due.push(ex);
    } else {
      if (ex.requires) {
        const req = reviewsById[ex.requires];
        if (!req || req.state === 'new') continue;
      }
      fresh.push(ex);
    }
  }
  due.sort((a, b) => reviewsById[a.id].due - reviewsById[b.id].due);
  const room = Math.max(0, newLimit - newDoneToday);
  return { due, fresh: fresh.slice(0, room), freshTotal: fresh.length };
}

/** 交錯排列：每 3 題複習插 1 題新題，讓新內容不會全擠在最後 */
export function interleave(due, fresh) {
  const out = [];
  let i = 0; let j = 0;
  while (i < due.length || j < fresh.length) {
    for (let k = 0; k < 3 && i < due.length; k++) out.push(due[i++]);
    if (j < fresh.length) out.push(fresh[j++]);
  }
  return out;
}
