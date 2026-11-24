// 範例包檔案格式（nihongo-pack）：解析、檢查、和現有教材比對
// 不依賴畫面，可以單獨測試。
import { parseJp, surface } from './furigana.js';
import { findDuplicate, sameGrammar, sameSentence } from './dupes.js';

export const PACK_FORMAT = 'nihongo-pack';
export const MAX_TEXT = 3 * 1024 * 1024;
const POS = ['noun', 'verb', 'i-adj', 'na-adj', 'adv', 'expr'];
const VERB_CLASS = ['', 'godan', 'ichidan', 'suru', 'kuru'];
export const NOUN = { words: '單字', grammar: '文法', sentences: '例句' };

const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const level = (v) => { const n = Number(v); return n >= 1 && n <= 5 ? Math.round(n) : 5; };

/**
 * 解析範例包文字。回傳 { pack, problems } 或丟出錯誤（整個檔案不能用的時候）
 * pack 裡每一項的 id 會加上範例包代號，例如 n4plus.gc01，
 * 這樣不會和你自己新增的項目撞號，同一個範例包重複匯入也認得出來。
 */
export function parsePack(text) {
  if (!text || !text.trim()) throw new Error('內容是空的');
  if (text.length > MAX_TEXT) throw new Error('檔案太大（超過 3 MB）');
  let raw;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error('這不是範例包檔案：內容不是正確的 JSON 格式。請確認貼上的是完整內容（從第一個 { 到最後一個 }）');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('這不是範例包檔案');
  if (raw.format !== PACK_FORMAT) {
    if (raw.app === 'nihongo-pwa') throw new Error('這是「學習紀錄備份」檔，請到「設定 → 匯入備份」匯入');
    throw new Error(`這不是範例包檔案（缺少 "format": "${PACK_FORMAT}"）`);
  }
  const key = str(raw.id);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(key)) throw new Error('範例包的 id 只能用小寫英文、數字和 -，例如 "n4-grammar"');
  const title = str(raw.title) || key;
  const problems = [];
  const prefix = (id) => `${key}.${id}`;
  const seen = { words: new Set(), grammar: new Set(), sentences: new Set() };
  const take = (table, list, fn) => (Array.isArray(list) ? list : []).flatMap((x, i) => {
    const where = `${NOUN[table]}第 ${i + 1} 項`;
    if (!x || typeof x !== 'object') { problems.push({ table, where, reason: '格式不對' }); return []; }
    const id = str(x.id);
    if (!id) { problems.push({ table, where, reason: '缺少 id' }); return []; }
    if (seen[table].has(id)) { problems.push({ table, where: `${where}（${id}）`, reason: 'id 和前面重複' }); return []; }
    seen[table].add(id);
    const reason = fn.check(x);
    if (reason) { problems.push({ table, where: `${where}（${id}）`, reason }); return []; }
    return [fn.make(x, id)];
  });

  const words = take('words', raw.words, {
    check: (w) => (!str(w.kana) ? '缺少讀音（kana）'
      : !str(w.meaning) ? '缺少中文意思（meaning）'
        : w.pos && !POS.includes(str(w.pos)) ? `詞類「${w.pos}」不正確`
          : str(w.pos) === 'verb' && !VERB_CLASS.slice(1).includes(str(w.verbClass)) ? '動詞要填動詞種類（verbClass：godan／ichidan／suru／kuru）'
            : null),
    make: (w, id) => ({
      id: prefix(id), kanji: str(w.kanji), kana: str(w.kana), meaning: str(w.meaning), pos: str(w.pos) || 'noun',
      verbClass: str(w.pos) === 'verb' ? str(w.verbClass) : '', jlpt: level(w.jlpt), falseFriend: Boolean(w.falseFriend), note: str(w.note),
    }),
  });
  const grammar = take('grammar', raw.grammar, {
    check: (g) => (!str(g.title) ? '缺少文法名稱（title）' : null),
    make: (g, id) => ({
      id: prefix(id), title: str(g.title), pattern: str(g.pattern), meaning: str(g.meaning), explanation: str(g.explanation), jlpt: level(g.jlpt),
    }),
  });
  const gIds = new Set(grammar.map((g) => g.id));
  const wIds = new Set(words.map((w) => w.id));
  const sentences = take('sentences', raw.sentences, {
    check: (s) => {
      const jp = str(s.jp);
      if (!jp) return '缺少日文例句（jp）';
      if (!str(s.zh)) return '缺少中文翻譯（zh）';
      if ((jp.match(/\{/g) || []).length !== (jp.match(/\}/g) || []).length) return '振假名的 { } 數量對不上';
      if ((jp.match(/\[\[/g) || []).length !== (jp.match(/\]\]/g) || []).length) return '挖空的 [[ ]] 數量對不上';
      if (/\{[^|}]*\}/.test(jp)) return '振假名要寫成 {漢字|かな}';
      if (/[[\]{}|]/.test(surface(parseJp(jp)))) return '標記格式有誤';
      return null;
    },
    make: (s, id) => {
      const g = str(s.grammar);
      if (g && !gIds.has(prefix(g))) problems.push({ table: 'sentences', where: `例句（${id}）`, reason: `對應的文法「${g}」不在這個範例包裡，例句會照樣加入，但不會連到文法`, soft: true });
      return {
        id: prefix(id), jp: str(s.jp), zh: str(s.zh),
        grammar: g && gIds.has(prefix(g)) ? prefix(g) : '',
        words: str(s.words).split(',').map((w) => w.trim()).filter(Boolean).map(prefix).filter((w) => wIds.has(w)).join(','),
      };
    },
  });
  if (!words.length && !grammar.length && !sentences.length) throw new Error('範例包裡沒有可以匯入的單字、文法或例句');
  return { pack: { key, title, description: str(raw.description), words, grammar, sentences }, problems };
}

/**
 * 比對你現有的教材，決定哪些要加、哪些略過（已經匯入過，或你已經有一樣的）。
 * 同名的文法會略過，它的例句改掛到你原本那一項。
 */
export function planImport(pack, content) {
  const have = {};
  ['words', 'grammar', 'sentences'].forEach((t) => { have[t] = content[t] || []; });
  const ids = (t) => new Set(have[t].map((x) => x.id));
  const plan = { words: [], grammar: [], sentences: [], skipped: { words: [], grammar: [], sentences: [] } };
  const wordRemap = {};
  const gramRemap = {};
  const wHave = ids('words');
  for (const w of pack.words) {
    if (wHave.has(w.id)) { plan.skipped.words.push({ name: w.kanji || w.kana, reason: '已經匯入過' }); continue; }
    const dup = findDuplicate('words', [...have.words, ...plan.words], w, null).block;
    if (dup) { wordRemap[w.id] = dup.id; plan.skipped.words.push({ name: w.kanji || w.kana, reason: '你已經有這個單字' }); continue; }
    plan.words.push(w);
  }
  const gHave = ids('grammar');
  for (const g of pack.grammar) {
    if (gHave.has(g.id)) { plan.skipped.grammar.push({ name: g.title, reason: '已經匯入過' }); continue; }
    const dup = sameGrammar([...have.grammar, ...plan.grammar], g);
    if (dup) { gramRemap[g.id] = dup.id; plan.skipped.grammar.push({ name: g.title, reason: `你已經有「${dup.title}」，例句會加到那一項` }); continue; }
    plan.grammar.push(g);
  }
  const sHave = ids('sentences');
  for (const s0 of pack.sentences) {
    const name = surface(parseJp(s0.jp)).replace(/\n/g, ' ');
    if (sHave.has(s0.id)) { plan.skipped.sentences.push({ name, reason: '已經匯入過' }); continue; }
    if (sameSentence([...have.sentences, ...plan.sentences], s0)) { plan.skipped.sentences.push({ name, reason: '你已經有一樣的例句' }); continue; }
    const s = { ...s0 };
    if (gramRemap[s.grammar]) s.grammar = gramRemap[s.grammar];
    s.words = s.words.split(',').filter(Boolean).map((w) => wordRemap[w] || w).join(',');
    plan.sentences.push(s);
  }
  return plan;
}

