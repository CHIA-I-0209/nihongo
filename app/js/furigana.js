// 例句格式解析與振假名顯示
//   {漢字|かな}          振假名
//   [[p:を]]             助詞挖空
//   [[g:答案|提示]]      文法挖空，答案內可含振假名，例如 [[g:{食|た}べました|食べる]]

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function splitTopLevel(str, sep) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === sep && depth === 0) return [str.slice(0, i), str.slice(i + 1)];
  }
  return [str, ''];
}

function parseInline(str) {
  const out = [];
  const re = /\{([^|{}]+)\|([^{}]+)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ t: 'text', text: str.slice(last, m.index) });
    out.push({ t: 'ruby', base: m[1], reading: m[2] });
    last = re.lastIndex;
  }
  if (last < str.length) out.push({ t: 'text', text: str.slice(last) });
  return out;
}

export function parseJp(str) {
  const out = [];
  const re = /\[\[(p|g):(.+?)\]\]/g;
  let last = 0;
  let m;
  let blankIndex = 0;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(...parseInline(str.slice(last, m.index)));
    const [answer, hint] = m[1] === 'g' ? splitTopLevel(m[2], '|') : [m[2], ''];
    out.push({ t: 'blank', kind: m[1], index: blankIndex++, tokens: parseInline(answer), hint: hint.trim() });
    last = re.lastIndex;
  }
  if (last < str.length) out.push(...parseInline(str.slice(last)));
  return out;
}

export function surface(tokens) {
  return tokens.map((t) => (t.t === 'blank' ? surface(t.tokens) : t.t === 'ruby' ? t.base : t.text)).join('');
}

export function reading(tokens) {
  return tokens.map((t) => (t.t === 'blank' ? reading(t.tokens) : t.t === 'ruby' ? t.reading : t.text)).join('');
}

function inlineHtml(tokens, furigana) {
  return tokens.map((t) => {
    if (t.t === 'ruby') {
      return furigana ? `<ruby>${esc(t.base)}<rt>${esc(t.reading)}</rt></ruby>` : esc(t.base);
    }
    if (t.t === 'text') return esc(t.text);
    return '';
  }).join('');
}

/**
 * 產生例句 HTML
 * opts.blank    要挖空的挖空編號（undefined 表示全部填回）
 * opts.reveal   挖空處顯示答案並標示
 */
export function sentenceHtml(tokens, { furigana = true, blank, reveal = false, hint = true } = {}) {
  return tokens.map((t) => {
    if (t.t !== 'blank') return inlineHtml([t], furigana);
    if (t.index === blank) {
      if (reveal) return `<mark class="filled">${inlineHtml(t.tokens, furigana)}</mark>`;
      const h = hint && t.hint ? `<span class="hint">（${esc(t.hint)}）</span>` : '';
      return `<span class="gap" aria-label="空格">　　</span>${h}`;
    }
    return inlineHtml(t.tokens, furigana);
  }).join('');
}

/** 單字的振假名：自動對齊送假名，例如 食べる／たべる → 食<rt>た</rt>べる */
export function wordHtml(kanji, kana, furigana = true) {
  if (!kanji) return esc(kana);
  if (!furigana || kanji === kana) return esc(kanji);
  let pre = 0;
  while (pre < kanji.length && pre < kana.length && kanji[pre] === kana[pre]) pre++;
  let suf = 0;
  while (suf < kanji.length - pre && suf < kana.length - pre
    && kanji[kanji.length - 1 - suf] === kana[kana.length - 1 - suf]) suf++;
  const kMid = kanji.slice(pre, kanji.length - suf);
  const rMid = kana.slice(pre, kana.length - suf);
  if (!kMid || !rMid) return esc(kanji);
  return esc(kanji.slice(0, pre)) + `<ruby>${esc(kMid)}<rt>${esc(rMid)}</rt></ruby>` + esc(kanji.slice(kanji.length - suf));
}
