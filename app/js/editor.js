// 在 App 裡新增、修改、刪除教材
import * as cloud from './cloud.js';
import { db } from './db.js';
import { conjugate, formsFor } from './conjugate.js';
import { esc, parseJp, sentenceHtml, surface, wordHtml } from './furigana.js';
import { bindKanaInput } from './kana.js';
import { POS_LABEL, state, $view, toast } from './ui.js';
import { loadAll, sentenceListHtml } from './main.js';

const PREFIX = { words: 'w', grammar: 'g', sentences: 's' };
const NOUN = { words: '單字', grammar: '文法', sentences: '例句' };

const JLPT = [5, 4, 3, 2, 1].map((n) => [n, `N${n}`]);
const VERB_CLASS = [
  ['godan', '五段（書く、飲む、帰る）'],
  ['ichidan', '一段（食べる、見る）'],
  ['suru', 'する動詞（勉強する）'],
  ['kuru', '来る'],
];

function fieldsFor(table) {
  if (table === 'words') {
    return [
      { key: 'kanji', label: '漢字寫法', hint: '沒有漢字就留空，例如 コーヒー' , lang: 'ja' },
      { key: 'kana', label: '讀音', hint: '可以直接打羅馬拼音，例如 taberu', required: true, kana: true, lang: 'ja' },
      { key: 'meaning', label: '中文意思', required: true },
      { key: 'pos', label: '詞類', type: 'select', options: Object.entries(POS_LABEL) },
      { key: 'verbClass', label: '動詞種類', type: 'select', options: VERB_CLASS, showIf: (v) => v.pos === 'verb' },
      { key: 'jlpt', label: 'JLPT 等級', type: 'select', options: JLPT },
      { key: 'falseFriend', label: '和中文意思不同（例如 手紙、勉強）', type: 'checkbox' },
      { key: 'note', label: '備註', hint: '答題後會顯示', type: 'textarea' },
    ];
  }
  if (table === 'grammar') {
    return [
      { key: 'title', label: '文法名稱', required: true, hint: '例如 〜てから', lang: 'ja' },
      { key: 'pattern', label: '接續方式', hint: '例如 動詞て形 ＋ から', lang: 'ja' },
      { key: 'meaning', label: '中文意思', required: true },
      { key: 'explanation', label: '說明', type: 'textarea' },
      { key: 'jlpt', label: 'JLPT 等級', type: 'select', options: JLPT },
    ];
  }
  return [
    { key: 'jp', label: '日文例句', required: true, type: 'textarea', lang: 'ja', tools: true },
    { key: 'zh', label: '中文翻譯', required: true },
    {
      key: 'grammar', label: '對應的文法', type: 'select',
      options: [['', '（沒有）'], ...(state.content.grammar || []).map((g) => [g.id, g.title])],
    },
  ];
}

const blank = {
  words: { kanji: '', kana: '', meaning: '', pos: 'noun', verbClass: '', jlpt: 5, falseFriend: false, note: '' },
  grammar: { title: '', pattern: '', meaning: '', explanation: '', jlpt: 5 },
  sentences: { jp: '', zh: '', words: '', grammar: '' },
};

function nextId(table) {
  const p = PREFIX[table];
  const nums = (state.content[table] || [])
    .map((x) => String(x.id).match(new RegExp(`^${p}(\\d+)$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return p + String(n).padStart(3, '0');
}

function backHash(table, item, query) {
  if (table === 'words') return '#/words';
  if (table === 'grammar') return item && item.id && state.exercises.grammarById[item.id] ? `#/grammar/${encodeURIComponent(item.id)}` : '#/grammar';
  const g = (item && item.grammar) || query.get('grammar');
  return g && state.exercises.grammarById[g] ? `#/grammar/${encodeURIComponent(g)}` : '#/sentences';
}

/* ---------- 預覽 ---------- */

/** 從例句找出用到的單字（漢字或假名出現在句子裡） */
function detectWords(jp) {
  const text = surface(parseJp(jp));
  return (state.content.words || []).filter((w) => {
    let needle = w.kanji || w.kana;
    if (!needle) return false;
    if (w.pos === 'verb' && w.verbClass === 'suru') needle = needle.replace(/する$/, '');
    else if ((w.pos === 'verb' || w.pos === 'i-adj') && needle.length > 1) needle = needle.slice(0, -1);
    return needle.length >= (/[㐀-鿿]/.test(needle) ? 1 : 2) && text.includes(needle);
  });
}

function previewHtml(table, v) {
  if (table === 'words') {
    if (!v.kana) return '<p class="help">填入讀音後會顯示預覽。</p>';
    const forms = formsFor(v);
    let conj = '';
    if (v.pos === 'verb' && !v.verbClass) conj = '<p class="warn">請選擇動詞種類，才能產生活用題。</p>';
    else if (forms.length) {
      const rows = forms.map((f) => [f.label, conjugate(v, f.key)]);
      if (rows.some(([, r]) => !r)) conj = '<p class="warn">這個詞的語尾和選的種類對不上，請檢查讀音和動詞種類。</p>';
      else {
        conj = `<table class="conj"><tbody>${rows.map(([label, r]) => `
          <tr><th>${esc(label)}</th><td lang="ja">${esc(r.display)}</td></tr>`).join('')}</tbody></table>
          <p class="help">會產生上面 ${rows.length} 題活用練習，請確認變化正確。</p>`;
      }
    }
    return `<p class="preview-word" lang="ja">${wordHtml(v.kanji, v.kana, true)}</p>${conj}`;
  }
  if (table === 'grammar') return '';
  if (!v.jp) {
    return `<p class="help">用下面的按鈕標記：先選取文字，再按按鈕。</p>`;
  }
  const opens = (v.jp.match(/\{/g) || []).length;
  const closes = (v.jp.match(/\}/g) || []).length;
  const bo = (v.jp.match(/\[\[/g) || []).length;
  const bc = (v.jp.match(/\]\]/g) || []).length;
  const tokens = parseJp(v.jp);
  const blanks = tokens.filter((t) => t.t === 'blank');
  const p = blanks.filter((b) => b.kind === 'p').length;
  const g = blanks.filter((b) => b.kind === 'g').length;
  const warn = [];
  if (opens !== closes) warn.push('振假名的 { } 數量對不上');
  if (bo !== bc) warn.push('挖空的 [[ ]] 數量對不上');
  if (/\{[^|}]*\}/.test(v.jp)) warn.push('振假名要寫成 {漢字|かな}，中間要有 |');
  const used = detectWords(v.jp);
  return `
    <p class="sentence" lang="ja">${sentenceHtml(tokens, { furigana: true, reveal: true, blank: -1 }).replace(/<\/?mark[^>]*>/g, '')}</p>
    <p class="help">${blanks.length ? `會產生 ${p ? `${p} 題助詞題` : ''}${p && g ? '、' : ''}${g ? `${g} 題文法題` : ''}。` : '還沒有挖空，這句只會出現在文法說明頁，不會出題。'}</p>
    ${used.length ? `<p class="help">用到的單字：<span lang="ja">${used.map((w) => esc(w.kanji || w.kana)).join('、')}</span>（學過這些字之後才會出這句）</p>` : ''}
    ${warn.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}`;
}

/* ---------- 表單 ---------- */

function fieldHtml(f, v) {
  const id = `f-${f.key}`;
  const value = v[f.key] ?? '';
  const hint = f.hint ? `<span class="hint-text">${esc(f.hint)}</span>` : '';
  const lang = f.lang ? ` lang="${f.lang}"` : '';
  const hidden = f.showIf && !f.showIf(v) ? ' hidden' : '';
  if (f.type === 'checkbox') {
    return `<label class="switch" data-field="${f.key}"${hidden}><input id="${id}" name="${f.key}" type="checkbox" ${value ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  }
  let control;
  if (f.type === 'select') {
    control = `<select id="${id}" name="${f.key}"${lang}>${f.options.map(([val, label]) => `<option value="${esc(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea id="${id}" name="${f.key}" rows="${f.tools ? 3 : 4}"${lang} ${f.required ? 'required' : ''}>${esc(value)}</textarea>`;
  } else {
    control = `<input id="${id}" name="${f.key}" type="text"${lang} autocomplete="off" ${f.kana ? 'autocapitalize="off" autocorrect="off" spellcheck="false"' : ''} ${f.required ? 'required' : ''} value="${esc(value)}">`;
  }
  const tools = f.tools ? `
    <div class="mark-tools" role="group" aria-label="標記工具">
      <button type="button" data-wrap="ruby">加振假名</button>
      <button type="button" data-wrap="p">助詞挖空</button>
      <button type="button" data-wrap="g">文法挖空</button>
    </div>` : '';
  return `<div class="field" data-field="${f.key}"${hidden}><label for="${id}">${esc(f.label)}${f.required || f.type === 'select' ? '' : '<span class="optional">（選填）</span>'}</label>${hint}${control}${tools}</div>`;
}

function readForm(form, table, base) {
  const v = { ...base };
  fieldsFor(table).forEach((f) => {
    const el = form.elements[f.key];
    if (!el) return;
    v[f.key] = f.type === 'checkbox' ? el.checked : el.value.trim();
  });
  if (v.jlpt !== undefined) v.jlpt = Number(v.jlpt) || 5;
  if (table === 'words' && v.pos !== 'verb') v.verbClass = '';
  return v;
}

/** 在選取的文字前後加上標記 */
function wrapSelection(ta, kind) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.slice(start, end);
  let text;
  let caret;
  if (kind === 'ruby') { text = `{${sel || '漢字'}|}`; caret = start + text.length - 1; }
  else if (kind === 'p') { text = `[[p:${sel || 'を'}]]`; caret = start + text.length; }
  else { text = `[[g:${sel || '答案'}|]]`; caret = start + text.length - 2; }
  ta.setRangeText(text, start, end, 'end');
  ta.focus();
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export function renderEditor(table, id, query) {
  const list = state.content[table] || [];
  const existing = id !== 'new' ? list.find((x) => x.id === id) : null;
  if (id !== 'new' && !existing) { location.hash = backHash(table, null, query); return; }
  const base = existing ? { ...existing } : { ...blank[table], ...(table === 'sentences' && query.get('grammar') ? { grammar: query.get('grammar') } : {}) };
  const fields = fieldsFor(table);
  const back = backHash(table, existing || base, query);

  $view.innerHTML = `
    <section class="editor">
      <a href="${back}" class="back">取消</a>
      <h1>${existing ? `編輯${NOUN[table]}` : `新增${NOUN[table]}`}</h1>
      <form id="edit-form" class="stack" novalidate>
        ${fields.map((f) => fieldHtml(f, base)).join('')}
        ${table === 'sentences' ? `
          <details class="format-help"><summary>標記格式說明</summary>
            <p><code lang="ja">{漢字|かな}</code>：振假名</p>
            <p><code lang="ja">[[p:を]]</code>：把助詞挖空，出選擇題</p>
            <p><code lang="ja">[[g:食べました|食べる]]</code>：把文法挖空，「|」後面是提示</p>
          </details>` : ''}
        ${table !== 'grammar' ? '<div class="preview" id="preview" aria-live="polite"></div>' : ''}
        <p class="form-error" id="edit-error" role="alert" hidden></p>
        <div class="row">
          <button type="submit" class="primary">${existing ? '儲存' : `新增${NOUN[table]}`}</button>
          ${existing ? '<button type="button" class="danger" id="delete">刪除</button>' : ''}
        </div>
        ${existing ? `<p class="version">編號：${esc(existing.id)}</p>` : ''}
      </form>
    </section>`;

  const form = document.getElementById('edit-form');
  const err = document.getElementById('edit-error');
  const preview = document.getElementById('preview');
  const refresh = () => {
    const v = readForm(form, table, base);
    fields.filter((f) => f.showIf).forEach((f) => {
      form.querySelector(`[data-field="${f.key}"]`).hidden = !f.showIf(v);
    });
    if (preview) preview.innerHTML = previewHtml(table, v);
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();

  if (form.elements.kana) bindKanaInput(form.elements.kana);
  form.querySelectorAll('[data-wrap]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // 保留文字選取
    b.onclick = () => wrapSelection(form.elements.jp, b.dataset.wrap);
  });
  const first = form.querySelector('input:not([type=checkbox]), textarea');
  if (!existing) setTimeout(() => first?.focus({ preventScroll: true }), 50);

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const v = readForm(form, table, base);
    const missing = fields.filter((f) => f.required && !v[f.key]);
    if (missing.length) {
      err.textContent = `請填寫：${missing.map((f) => f.label).join('、')}`;
      err.hidden = false;
      form.elements[missing[0].key].focus();
      return;
    }
    if (table === 'words' && v.pos === 'verb' && !v.verbClass) {
      err.textContent = '請選擇動詞種類';
      err.hidden = false;
      return;
    }
    if (table === 'sentences') v.words = detectWords(v.jp).map((w) => w.id).join(',');
    if (!existing) {
      v.id = nextId(table);
      v.sort = Math.max(0, ...list.map((x) => Number(x.sort) || 0)) + 10;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await cloud.saveItems(table, [v]);
      const next = existing ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v];
      await saveLocal(table, next);
      toast(existing ? '已儲存' : `已新增${NOUN[table]}`);
      location.hash = table === 'grammar' && !existing ? `#/grammar/${encodeURIComponent(v.id)}` : backHash(table, v, query);
    } catch (ex) {
      err.textContent = ex.code === 'network' ? '需要網路才能儲存教材，請連上網路後再試' : ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };

  document.getElementById('delete')?.addEventListener('click', async () => {
    const name = table === 'words' ? (existing.kanji || existing.kana) : table === 'grammar' ? existing.title : '這個例句';
    if (!confirm(`刪除「${name}」？相關的練習題也會一起消失。`)) return;
    try {
      await cloud.deleteItem(table, existing.id);
      await saveLocal(table, list.filter((x) => x.id !== existing.id));
      toast('已刪除');
      location.hash = backHash(table, table === 'grammar' ? null : existing, query);
    } catch (ex) {
      err.textContent = ex.code === 'network' ? '需要網路才能刪除教材' : ex.message;
      err.hidden = false;
    }
  });
}

async function saveLocal(table, items) {
  const content = { ...state.content, [table]: items, updatedAt: Date.now() };
  await db.set('content', content);
  await loadAll();
}

export function renderSentenceList() {
  const sentences = state.content.sentences || [];
  $view.innerHTML = `
    <section class="detail">
      <div class="title-row">
        <a href="#/grammar" class="back">文法列表</a>
        <a href="#/edit/sentences/new" class="button">新增例句</a>
      </div>
      <h1>所有例句 <span class="sub">${sentences.length} 句</span></h1>
      ${sentenceListHtml(sentences, '還沒有例句。')}
    </section>`;
}
