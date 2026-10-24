// 動詞、形容詞活用規則

export const FORMS = {
  verb: [
    { key: 'masu', label: 'ます形' },
    { key: 'nai', label: 'ない形' },
    { key: 'te', label: 'て形' },
    { key: 'ta', label: 'た形' },
  ],
  'i-adj': [
    { key: 'nai', label: '否定（〜くない）' },
    { key: 'ta', label: '過去（〜かった）' },
    { key: 'te', label: 'て形（〜くて）' },
  ],
  'na-adj': [
    { key: 'nai', label: '否定（〜じゃない）' },
    { key: 'ta', label: '過去（〜だった）' },
    { key: 'te', label: 'て形（〜で）' },
  ],
};

// う段 → [あ段, い段]
const GODAN = {
  'う': ['わ', 'い'], 'く': ['か', 'き'], 'ぐ': ['が', 'ぎ'], 'す': ['さ', 'し'], 'つ': ['た', 'ち'],
  'ぬ': ['な', 'に'], 'ぶ': ['ば', 'び'], 'む': ['ま', 'み'], 'る': ['ら', 'り'],
};

function godanTeTa(base, last, form) {
  const isTe = form === 'te';
  const stem = base.slice(0, -1);
  // 行く 是例外：行って／行った
  if (base.endsWith('行く') || base === 'いく' || base.endsWith('ていく')) {
    return stem + (isTe ? 'って' : 'った');
  }
  switch (last) {
    case 'う': case 'つ': case 'る': return stem + (isTe ? 'って' : 'った');
    case 'む': case 'ぶ': case 'ぬ': return stem + (isTe ? 'んで' : 'んだ');
    case 'く': return stem + (isTe ? 'いて' : 'いた');
    case 'ぐ': return stem + (isTe ? 'いで' : 'いだ');
    case 'す': return stem + (isTe ? 'して' : 'した');
  }
  return null;
}

function conjVerb(base, verbClass, form) {
  if (!base) return null;
  if (verbClass === 'suru') {
    if (!base.endsWith('する')) return null;
    const p = base.slice(0, -2);
    return p + { masu: 'します', nai: 'しない', te: 'して', ta: 'した' }[form];
  }
  if (verbClass === 'kuru') {
    if (base.endsWith('来る')) {
      const p = base.slice(0, -2);
      return p + { masu: '来ます', nai: '来ない', te: '来て', ta: '来た' }[form];
    }
    if (base.endsWith('くる')) {
      const p = base.slice(0, -2);
      return p + { masu: 'きます', nai: 'こない', te: 'きて', ta: 'きた' }[form];
    }
    return null;
  }
  if (verbClass === 'ichidan') {
    if (!base.endsWith('る')) return null;
    const stem = base.slice(0, -1);
    return stem + { masu: 'ます', nai: 'ない', te: 'て', ta: 'た' }[form];
  }
  if (verbClass === 'godan') {
    const last = base.slice(-1);
    const row = GODAN[last];
    if (!row) return null;
    const stem = base.slice(0, -1);
    if (form === 'masu') return stem + row[1] + 'ます';
    if (form === 'nai') return base === 'ある' ? 'ない' : stem + row[0] + 'ない';
    return godanTeTa(base, last, form);
  }
  return null;
}

function conjIAdj(base, form) {
  if (!base || !base.endsWith('い')) return null;
  // いい／良い 的變化用「よ」
  let stem = base.slice(0, -1);
  if (base === 'いい' || base.endsWith('かっこいい')) stem = base.slice(0, -2) + 'よ';
  return stem + { nai: 'くない', ta: 'かった', te: 'くて' }[form];
}

function conjNaAdj(base, form) {
  if (!base) return null;
  const b = base.replace(/な$/, '');
  return { nai: [b + 'じゃない', b + 'ではない'], ta: [b + 'だった'], te: [b + 'で'] }[form];
}

/**
 * 回傳 { answers: [可接受的寫法...], display: 正解的主要寫法, kana: 讀音 }
 * 同時處理漢字寫法與假名寫法。
 */
export function conjugate(word, form) {
  const forms = [];
  const bases = [word.kana, word.kanji].filter(Boolean);
  let display = null;
  let kana = null;
  bases.forEach((base, idx) => {
    let r = null;
    if (word.pos === 'verb') r = conjVerb(base, word.verbClass, form);
    else if (word.pos === 'i-adj') r = conjIAdj(base, form);
    else if (word.pos === 'na-adj') r = conjNaAdj(base, form);
    if (!r) return;
    const list = Array.isArray(r) ? r : [r];
    forms.push(...list);
    if (idx === 0) kana = list[0];
    display = list[0]; // 有漢字寫法時以漢字為主
  });
  if (!forms.length) return null;
  return { answers: [...new Set(forms)], display, kana };
}

export function formsFor(word) {
  if (word.pos === 'verb' && ['godan', 'ichidan', 'suru', 'kuru'].includes(word.verbClass)) return FORMS.verb;
  if (word.pos === 'i-adj') return FORMS['i-adj'];
  if (word.pos === 'na-adj') return FORMS['na-adj'];
  return [];
}
