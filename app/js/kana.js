// 羅馬拼音 → 平假名，以及答案比對用的正規化

const BASE = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  la: 'ら', li: 'り', lu: 'る', le: 'れ', lo: 'ろ',
  wa: 'わ', wi: 'うぃ', we: 'うぇ', wo: 'を',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  je: 'じぇ', che: 'ちぇ', she: 'しぇ', tsa: 'つぁ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', xtu: 'っ', xtsu: 'っ', ltu: 'っ', ltsu: 'っ',
  "n'": 'ん', nn: 'ん', xn: 'ん',
  '-': 'ー', '.': '。', ',': '、', '?': '？', '!': '！', '~': '〜',
  '[': '「', ']': '」',
};

// 拗音：kya / sha / cha / ja ...
const YOON = {
  k: 'き', g: 'ぎ', n: 'に', h: 'ひ', b: 'び', p: 'ぴ', m: 'み', r: 'り',
  s: 'し', z: 'じ', t: 'ち', d: 'ぢ', j: 'じ',
};
const SMALL = { a: 'ゃ', u: 'ゅ', o: 'ょ', e: 'ぇ' };
for (const [c, kana] of Object.entries(YOON)) {
  for (const v of ['a', 'u', 'o']) BASE[c + 'y' + v] = kana + SMALL[v];
}
for (const v of ['a', 'u', 'o', 'e']) {
  BASE['sh' + v] = 'し' + SMALL[v];
  BASE['ch' + v] = 'ち' + SMALL[v];
  BASE['j' + v] = 'じ' + SMALL[v];
}
BASE.she = 'しぇ'; BASE.che = 'ちぇ'; BASE.je = 'じぇ';

const KEYS = Object.keys(BASE);
const MAX_KEY = Math.max(...KEYS.map((k) => k.length));
const PREFIXES = new Set();
for (const k of KEYS) for (let i = 1; i < k.length; i++) PREFIXES.add(k.slice(0, i));

const VOWELS = 'aiueo';

/**
 * 把羅馬拼音轉成平假名。
 * final=false 時（邊打邊轉），結尾還沒打完的部分（例如 "k"、"ky"、"n"）會保留原樣。
 */
export function romajiToHiragana(input, { final = true } = {}) {
  let out = '';
  let i = 0;
  const s = input;
  while (i < s.length) {
    const ch = s[i];
    const lower = ch.toLowerCase();

    if (!/[a-z'\-.,?!~\[\]]/i.test(ch)) { out += ch; i++; continue; }

    const next = s[i + 1] ? s[i + 1].toLowerCase() : undefined;

    // ん
    if (lower === 'n') {
      if (next === undefined) {
        if (final) { out += 'ん'; } else { out += ch; }
        i++; continue;
      }
      if (next === 'n') {
        const after = s[i + 2] ? s[i + 2].toLowerCase() : undefined;
        // 邊打邊轉時，結尾的 nn 先保留，等下一個字決定是「ん＋な行」還是單純的「ん」
        if (after === undefined && !final) { out += s.slice(i); break; }
        // onna → おんな、konnichiha → こんにちは：第一個 n 是ん，第二個 n 接後面的母音
        if (after && (VOWELS.includes(after) || after === 'y')) { out += 'ん'; i += 1; continue; }
        out += 'ん'; i += 2; continue;
      }
      if (next === "'") { out += 'ん'; i += 2; continue; }
      if (!VOWELS.includes(next) && next !== 'y') {
        out += 'ん'; i++; continue;
      }
    }

    // 促音：重複子音 → っ
    if (next === lower && /[bcdfghjkmpqrstvwxyz]/.test(lower)) {
      out += 'っ'; i++; continue;
    }
    // tch → っち
    if (lower === 't' && next === 'c' && s[i + 2] && s[i + 2].toLowerCase() === 'h') {
      out += 'っ'; i++; continue;
    }

    let matched = false;
    for (let len = Math.min(MAX_KEY, s.length - i); len >= 1; len--) {
      const chunk = s.slice(i, i + len).toLowerCase();
      if (BASE[chunk]) {
        out += BASE[chunk];
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 還沒打完的音節
    const rest = s.slice(i).toLowerCase();
    if (!final && PREFIXES.has(rest)) { out += s.slice(i); break; }

    out += ch;
    i++;
  }
  return out;
}

export function katakanaToHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 比對答案前的正規化：轉平假名、去掉空白與標點 */
export function normalizeAnswer(str) {
  return katakanaToHiragana(romajiToHiragana(String(str || '').trim(), { final: true }))
    .replace(/[\s　。、．，,.！？!?「」『』（）()]/g, '')
    .replace(/〜|~/g, '');
}

export function hasKanji(str) {
  return /[㐀-鿿々]/.test(str);
}

/**
 * 讓 <input> 支援邊打羅馬拼音邊轉假名。
 * 使用者用日文輸入法（IME 組字中）時不干涉。
 */
export function bindKanaInput(input) {
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('input', () => {
    if (composing) return;
    const before = input.value;
    const after = romajiToHiragana(before, { final: false });
    if (after !== before) {
      input.value = after;
      input.setSelectionRange(after.length, after.length);
    }
  });
}
