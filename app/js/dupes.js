// 防呆：找出重複的單字、文法、例句
import { parseJp, surface } from './furigana.js';
import { katakanaToHiragana } from './kana.js';

/** 比對用：全形半形統一、去掉 〜 和空白、片假名轉平假名、英文小寫 */
export function norm(str) {
  return katakanaToHiragana(String(str || '').normalize('NFKC'))
    .replace(/[~〜～\s・]/g, '')
    .toLowerCase();
}

/** 文法名稱去掉括號說明：「〜そうです（傳聞）」→「そうです」 */
function core(title) {
  return norm(title).replace(/\([^)]*\)/g, '');
}

/** 例句比對：只看文字，忽略振假名、挖空標記、A：B：、標點 */
function sentenceKey(jp) {
  return norm(surface(parseJp(String(jp || ''))))
    .replace(/(^|\n)[a-z][:：]/g, '$1')
    .replace(/[。、，,.！!？?「」『』（）()…]/g, '');
}

/** 例句完全比對：文字一樣、挖空的位置和答案也一樣（忽略振假名、提示、標點） */
function sentenceExactKey(jp) {
  const tokens = parseJp(String(jp || ''));
  const text = tokens.map((t) => (t.t === 'blank' ? `[${t.kind}:${surface(t.tokens)}]` : t.t === 'ruby' ? t.base : t.text)).join('');
  return norm(text)
    .replace(/(^|\n)[a-z][:：]/g, '$1')
    .replace(/[。、，,.！!？?「」『』（）()…]/g, '');
}

/**
 * 回傳 { block: 已經存在的項目 | null, similar: 類似但允許的項目[] }
 * block：一模一樣，不能存
 * similar：可能重複，提醒但允許（例如同音不同字、同名但括號說明不同）
 */
export function findDuplicate(table, items, v, selfId) {
  const others = (items || []).filter((x) => x.id !== selfId);
  if (table === 'words') {
    const kana = norm(v.kana);
    const kanji = norm(v.kanji);
    if (!kana && !kanji) return { block: null, similar: [] };
    const block = others.find((w) => norm(w.kana) === kana && norm(w.kanji) === kanji) || null;
    const similar = block ? [] : others.filter((w) => (kanji && norm(w.kanji) === kanji) || (kana && norm(w.kana) === kana));
    return { block, similar };
  }
  if (table === 'grammar') {
    const t = norm(v.title);
    if (!t) return { block: null, similar: [] };
    const block = others.find((g) => norm(g.title) === t) || null;
    const c = core(v.title);
    const similar = block || !c ? [] : others.filter((g) => core(g.title) === c);
    return { block, similar };
  }
  if (table === 'sentences') {
    // 文字和挖空都一樣才擋；文字一樣但挖空不同，是不同的題目，只提醒
    const k = sentenceKey(v.jp);
    if (!k) return { block: null, similar: [] };
    const ek = sentenceExactKey(v.jp);
    const block = others.find((s) => sentenceExactKey(s.jp) === ek) || null;
    const similar = block ? [] : others.filter((s) => sentenceKey(s.jp) === k);
    return { block, similar };
  }
  return { block: null, similar: [] };
}

/** 給畫面顯示用的名稱 */
export function itemName(table, x) {
  if (table === 'words') return x.kanji ? `${x.kanji}（${x.kana}）` : x.kana;
  if (table === 'grammar') return x.title;
  return surface(parseJp(x.jp)).replace(/\n/g, ' ').replace(/[。．.！!？?]+$/, '');
}

/** 範例包加入時用：這個文法在既有教材裡是否已經有同名的（回傳既有的那一項） */
export function sameGrammar(items, g) {
  const t = norm(g.title);
  return (items || []).find((x) => norm(x.title) === t) || null;
}

export function sameSentence(items, s) {
  const k = sentenceExactKey(s.jp);
  return (items || []).find((x) => sentenceExactKey(x.jp) === k) || null;
}

/** 文法搜尋：名稱、接續、意思、說明都比對 */
export function matchGrammar(g, q) {
  const k = norm(q);
  if (!k) return true;
  return [g.title, g.pattern, g.meaning, g.explanation].some((f) => norm(f).includes(k));
}
