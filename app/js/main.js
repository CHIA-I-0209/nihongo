import { db, requestPersistence } from './db.js';
import { SEED } from './seed.js';
import { buildExercises, buildQueue, interleave, checkAnswer, TYPE_LABEL } from './exercises.js';
import { newState, schedule, previewInterval, replay } from './fsrs.js';
import { bindKanaInput } from './kana.js';
import { esc, sentenceHtml, wordHtml, reading as tokensReading } from './furigana.js';
import * as cloud from './cloud.js';
import { deviceName } from './device.js';
import {
  APP_VERSION, DEFAULT_SETTINGS, POS_LABEL, state, $view, todayKey, uuid, toast, relativeTime, speak, speakBtn,
} from './ui.js';
import { renderLogin, renderSetupNeeded, renderNewPassword } from './auth.js';
import { renderEditor, renderSentenceList } from './editor.js';
import { parseJp as parseSentence } from './furigana.js';

/* ---------- 資料載入 ---------- */

export async function loadAll() {
  state.settings = { ...DEFAULT_SETTINGS, ...(await db.get('settings', {})) };
  state.content = (await db.get('content')) || { words: [], grammar: [], sentences: [] };
  state.exercises = buildExercises(state.content);
  const reviews = await db.allReviews();
  state.reviews = Object.fromEntries(reviews.map((r) => [r.exerciseId, r]));
}

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.set('settings', state.settings);
}

function handleCloudError(e) {
  if (e.code === 'signed_out') {
    toast('登入已過期，請重新登入');
    showLogin();
  }
  return e instanceof cloud.CloudError ? e.message : `同步失敗：${e.message}`;
}

export async function runSync({ quiet = false } = {}) {
  if (state.syncing) { state.lastSyncError = '上一次同步還在進行，請稍後再試'; return null; }
  if (!navigator.onLine) { state.lastSyncError = '目前離線，連上網路後會自動同步'; return null; }
  state.syncing = true;
  try {
    const r = await cloud.syncAll();
    await loadAll();
    if (!quiet || r.contentUpdated || r.pulled) {
      const parts = [];
      if (r.pushed) parts.push(`上傳 ${r.pushed} 筆紀錄`);
      if (r.pulled) parts.push(`下載 ${r.pulled} 筆紀錄`);
      if (r.contentUpdated) parts.push('教材已更新');
      toast(parts.length ? `已同步：${parts.join('，')}` : '已同步，沒有新資料');
    }
    state.lastSyncError = '';
    return r;
  } catch (e) {
    state.lastSyncError = handleCloudError(e);
    if (!quiet) toast(state.lastSyncError);
    return null;
  } finally {
    state.syncing = false;
  }
}

async function todayStats() {
  const newDone = await db.get(`new:${todayKey()}`, 0);
  const queue = buildQueue(state.exercises, state.reviews, { newLimit: state.settings.newLimit, newDoneToday: newDone });
  return { newDone, queue };
}

async function streak() {
  // 從所有答題紀錄計算（包含其他裝置同步來的）
  const days = new Set((await db.allLogs()).map((l) => todayKey(new Date(l.reviewedAt))));
  let n = 0;
  const d = new Date();
  if (!days.has(todayKey(d))) d.setDate(d.getDate() - 1); // 今天還沒學不算斷
  while (days.has(todayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- 首頁 ---------- */

async function renderHome() {
  await writeChain;
  const { queue } = await todayStats();
  const learned = state.exercises.list.filter((e) => state.reviews[e.id] && state.reviews[e.id].state !== 'new').length;
  const total = state.exercises.list.length;
  const days = await streak();
  const lastSync = await db.get('lastSync', 0);
  const dueN = queue.due.length;
  const newN = queue.fresh.length;
  const nothing = dueN + newN === 0;

  let lead;
  if (total === 0) lead = '還沒有教材。到「單字」分頁新增第一個單字吧。';
  else if (nothing && queue.freshTotal === 0 && learned === total) lead = '所有題目都學過了，等複習時間到再回來。';
  else if (nothing) lead = '今天的份量完成了。明天會有新的複習。';
  else if (dueN && newN) lead = `要複習 ${dueN} 題，再學 ${newN} 題新的。`;
  else if (dueN) lead = `要複習 ${dueN} 題。`;
  else lead = `可以學 ${newN} 題新的。`;

  $view.innerHTML = `
    <section class="home">
      <p class="date">${new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' })}</p>
      <h1 class="lead">${esc(lead)}</h1>
      <button type="button" class="primary big" id="start" ${nothing ? 'disabled' : ''}>開始學習</button>

      <dl class="facts">
        <div><dt>連續學習</dt><dd><strong>${days}</strong> 天</dd></div>
        <div><dt>學過的題目</dt><dd><strong>${learned}</strong> / ${total}</dd></div>
      </dl>
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${learned}" aria-label="學習進度">
        <span style="width:${total ? (learned / total) * 100 : 0}%"></span>
      </div>

      <p class="sync-line">
        ${state.syncing && !lastSync ? '正在下載教材…' : `上次同步：${relativeTime(lastSync)}`}
        <button type="button" class="link" id="sync-now">立即同步</button>
      </p>
    </section>`;
  document.getElementById('start')?.addEventListener('click', startSession);
  document.getElementById('sync-now')?.addEventListener('click', async () => { await runSync(); renderHome(); });
}

/* ---------- 學習 ---------- */

async function startSession() {
  const { queue } = await todayStats();
  const items = interleave(queue.due, queue.fresh);
  if (!items.length) return;
  state.session = { items, idx: 0, done: 0, correct: 0, answered: 0, startedAt: Date.now() };
  location.hash = '#/study';
}

function promptHtml(ex, rv) {
  const fg = state.settings.furigana;
  const w = ex.word;
  switch (ex.type) {
    case 'reading':
      return `<div class="prompt ja" lang="ja">${esc(w.kanji)}</div>
        <p class="ask">寫出讀音</p>`;
    case 'recall':
      return `<div class="prompt zh">${esc(w.meaning)}</div>
        <p class="ask">${esc(POS_LABEL[w.pos] || '')}・用日文寫出來</p>`;
    case 'conj':
      return `<div class="prompt ja" lang="ja">${wordHtml(w.kanji, w.kana, fg)}</div>
        <p class="ask">改成<strong>${esc(ex.form.label)}</strong></p>`;
    case 'particle':
    case 'grammar': {
      const g = ex.grammar;
      const intro = ex.type === 'grammar' && g && (!rv || rv.state === 'new')
        ? `<details class="new-grammar" open><summary>新文法：<span lang="ja">${esc(g.title)}</span></summary>
            <p><span class="pattern" lang="ja">${esc(g.pattern)}</span>　${esc(g.meaning)}</p>
            <p>${esc(g.explanation)}</p></details>`
        : '';
      const ask = ex.type === 'particle'
        ? '選出空格裡的助詞'
        : `填入正確的形式${g ? `（<span lang="ja">${esc(g.title)}</span>）` : ''}`;
      return `${intro}<div class="prompt sentence" lang="ja">${sentenceHtml(ex.tokens, { furigana: fg, blank: ex.blankIndex })}</div>
        <p class="translation">${esc(ex.sentence.zh)}</p>
        <p class="ask">${ask}</p>`;
    }
  }
  return '';
}

function answerHtml(ex) {
  const fg = state.settings.furigana;
  const w = ex.word;
  if (ex.type === 'reading' || ex.type === 'recall') {
    const ff = w.falseFriend ? '<span class="tag">和中文意思不同</span>' : '';
    return `<div class="reveal">
      <p class="reveal-main" lang="ja">${wordHtml(w.kanji, w.kana, true)} ${speakBtn(w.kana)}</p>
      <p>${esc(w.meaning)} ${ff}</p>
      ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    </div>`;
  }
  if (ex.type === 'conj') {
    const showKana = ex.kana && ex.kana !== ex.display;
    return `<div class="reveal">
      <p class="reveal-main" lang="ja">${esc(ex.display)}${showKana ? `<span class="kana">${esc(ex.kana)}</span>` : ''} ${speakBtn(ex.kana || ex.display)}</p>
      ${ex.answers.length > 2 ? `<p class="note">也可以寫成：<span lang="ja">${ex.answers.filter((a) => a !== ex.display && a !== ex.kana).map(esc).join('、')}</span></p>` : ''}
      ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    </div>`;
  }
  const g = ex.grammar;
  return `<div class="reveal">
    <p class="reveal-main sentence" lang="ja">${sentenceHtml(ex.tokens, { furigana: fg, blank: ex.blankIndex, reveal: true })} ${speakBtn(tokensReading(ex.tokens))}</p>
    ${ex.type === 'grammar' && g ? `<p class="note"><span lang="ja">${esc(g.title)}</span>：${esc(g.meaning)}</p>` : ''}
  </div>`;
}

const MARK_OK = '<svg class="mark ok" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38"/></svg>';
const MARK_NG = '<svg class="mark ng" viewBox="0 0 100 100" aria-hidden="true"><path d="M22 22 78 78"/><path d="M78 22 22 78"/></svg>';

function renderStudy() {
  const s = state.session;
  if (!s) { location.hash = '#/'; return; }
  if (s.idx >= s.items.length) { renderSummary(); return; }

  const ex = s.items[s.idx];
  const rv = state.reviews[ex.id];
  const isNew = !rv || rv.state === 'new';
  const progress = (s.idx / s.items.length) * 100;

  const inputArea = ex.type === 'particle'
    ? `<div class="choices" lang="ja">${ex.choices.map((c) => `<button type="button" class="choice" data-choice="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
    : `<form class="answer" autocomplete="off">
        <input id="answer" type="text" lang="ja" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false"
          placeholder="${ex.type === 'recall' ? '假名或漢字，例如 taberu' : '用羅馬拼音打，會自動轉假名'}" aria-label="你的答案">
        <button type="submit" class="primary">對答案</button>
      </form>`;

  $view.innerHTML = `
    <section class="study">
      <header class="study-bar">
        <button type="button" class="icon" id="quit" aria-label="結束這回合"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${s.items.length}" aria-valuenow="${s.idx}"><span style="width:${progress}%"></span></div>
        <span class="count">${s.idx + 1}／${s.items.length}</span>
      </header>
      <article class="card" id="card">
        <p class="kind">${esc(TYPE_LABEL[ex.type])}${isNew ? '<span class="new">新</span>' : ''}</p>
        ${promptHtml(ex, rv)}
        <div class="mark-slot" id="mark"></div>
      </article>
      <div class="respond" id="respond">${inputArea}</div>
    </section>`;

  document.getElementById('quit').onclick = () => {
    if (s.answered === 0 || confirm('結束這回合？已作答的進度都會保存。')) renderSummary();
  };

  if (ex.type === 'particle') {
    $view.querySelectorAll('[data-choice]').forEach((b) => {
      b.onclick = () => {
        $view.querySelectorAll('[data-choice]').forEach((x) => { x.disabled = true; });
        const ok = checkAnswer(ex, b.dataset.choice);
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) $view.querySelector(`[data-choice="${CSS.escape(ex.display)}"]`)?.classList.add('right');
        reveal(ex, ok, b.dataset.choice);
      };
    });
  } else {
    const input = document.getElementById('answer');
    // 中→日 的題目允許直接用日文輸入法打漢字；其他題目只需要假名
    bindKanaInput(input);
    setTimeout(() => input.focus({ preventScroll: true }), 50);
    $view.querySelector('form.answer').onsubmit = (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      input.disabled = true;
      reveal(ex, checkAnswer(ex, input.value), input.value);
    };
  }
}

function reveal(ex, ok, given) {
  const s = state.session;
  s.answered++;
  if (ok) s.correct++;
  const rv = state.reviews[ex.id] || newState(ex.id);
  document.getElementById('mark').innerHTML = ok ? MARK_OK : MARK_NG;
  document.getElementById('card').classList.add(ok ? 'is-right' : 'is-wrong');

  const respond = document.getElementById('respond');
  const form = respond.querySelector('form.answer');
  if (form) form.remove();

  const yours = !ok && ex.type !== 'particle'
    ? `<p class="yours">你的答案：<span lang="ja">${esc(given)}</span></p>` : '';

  const buttons = ok
    ? `<div class="rate">
        ${[[2, '困難'], [3, '記得'], [4, '簡單']].map(([r, label]) => `
          <button type="button" class="${r === 3 ? 'primary' : ''}" data-rate="${r}">
            ${label}<small>${previewInterval(rv, r)}後</small>
          </button>`).join('')}
      </div>`
    : `<div class="rate single">
        <button type="button" class="primary" data-rate="1">繼續<small>稍後再出一次</small></button>
      </div>
      ${ex.type !== 'particle' ? '<button type="button" class="link override" data-rate="3">其實我答對了</button>' : ''}`;

  respond.insertAdjacentHTML('beforeend', `${yours}${answerHtml(ex)}${buttons}`);
  respond.querySelectorAll('[data-rate]').forEach((b) => {
    b.onclick = () => rate(ex, Number(b.dataset.rate));
  });
  const main = respond.querySelector('.rate .primary');
  setTimeout(() => main?.focus({ preventScroll: true }), 30);

  // 答完自動念一次正確答案
  if (ex.type === 'reading' || ex.type === 'recall') speak(ex.word.kana);
  else if (ex.type === 'conj') speak(ex.kana || ex.display);
  else speak(tokensReading(ex.tokens));
  respond.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

let writeChain = Promise.resolve();

function rate(ex, rating) {
  const s = state.session;
  if (!s || s.items[s.idx] !== ex) return; // 防止連點
  const now = Date.now();
  const prev = state.reviews[ex.id] || newState(ex.id);
  const next = schedule(prev, rating, now);
  const log = { id: uuid(), exerciseId: ex.id, rating, reviewedAt: now, device: deviceName(), synced: 0 };
  state.reviews[ex.id] = next;

  // 答錯的題目在幾題之後再出一次
  if (rating === 1) {
    const at = Math.min(s.items.length, s.idx + 4);
    s.items.splice(at, 0, ex);
  }
  s.done++;
  s.idx++;
  renderStudy(); // 先換下一題，存檔在背景依序進行

  const today = todayKey();
  writeChain = writeChain.then(async () => {
    await db.recordAnswer(log, next);
    if (prev.state === 'new') await db.set(`new:${today}`, (await db.get(`new:${today}`, 0)) + 1);
  }).catch((e) => toast(`存檔失敗：${e.message}`));
}

async function renderSummary() {
  const s = state.session;
  state.session = null;
  const rate = s && s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
  const mins = s ? Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)) : 0;
  $view.innerHTML = `
    <section class="summary">
      <h1>這回合完成了</h1>
      <dl class="facts">
        <div><dt>作答</dt><dd><strong>${s ? s.answered : 0}</strong> 題</dd></div>
        <div><dt>答對</dt><dd><strong>${rate}</strong>%</dd></div>
        <div><dt>花了</dt><dd><strong>${mins}</strong> 分鐘</dd></div>
      </dl>
      <p class="sync-line" id="sum-sync">正在同步…</p>
      <a class="button primary big" href="#/">回首頁</a>
    </section>`;
  await writeChain;
  const r = await runSync({ quiet: true });
  const el = document.getElementById('sum-sync');
  if (el) el.textContent = r ? '已同步到雲端。' : `紀錄已存在這台裝置上，${state.lastSyncError ? `但還沒同步（${state.lastSyncError}）` : '下次連上網路時會同步'}。`;
}

/* ---------- 單字 ---------- */

function mastery(exId) {
  const r = state.reviews[exId];
  if (!r || r.state === 'new') return { key: 'new', label: '未學' };
  if (r.stability >= 21) return { key: 'known', label: '熟悉' };
  return { key: 'learning', label: '學習中' };
}

function renderWords() {
  const words = state.content.words || [];
  $view.innerHTML = `
    <section class="list-page">
      <div class="title-row">
        <h1>單字 <span class="sub">${words.length} 個</span></h1>
        <a class="button" href="#/edit/words/new">新增單字</a>
      </div>
      <input type="search" id="q" placeholder="搜尋漢字、假名或中文" aria-label="搜尋單字">
      <ul class="words" id="word-list"></ul>
    </section>`;
  const list = document.getElementById('word-list');
  const draw = (q = '') => {
    const ql = q.trim().toLowerCase();
    const rows = words.filter((w) => !ql || [w.kanji, w.kana, w.meaning].some((x) => String(x || '').toLowerCase().includes(ql)));
    list.innerHTML = rows.length ? rows.map((w) => {
      const m = mastery(`w:${w.id}:recall`);
      return `<li>
        <a class="w-link" href="#/edit/words/${encodeURIComponent(w.id)}" aria-label="編輯 ${esc(w.kanji || w.kana)}">
          <span class="w-jp" lang="ja">${wordHtml(w.kanji, w.kana, true)}</span>
          <span class="w-zh">${esc(w.meaning)}${w.falseFriend ? ' <span class="tag">假朋友</span>' : ''}</span>
        </a>
        <span class="level ${m.key}">${m.label}</span>
        ${speakBtn(w.kana)}
      </li>`;
    }).join('') : `<li class="empty">${words.length ? '找不到符合的單字' : '還沒有單字。'}</li>`;
  };
  draw();
  document.getElementById('q').addEventListener('input', (e) => draw(e.target.value));
}

/* ---------- 文法 ---------- */

function renderGrammarList() {
  const grammar = state.content.grammar || [];
  const sCount = (state.content.sentences || []).length;
  $view.innerHTML = `
    <section class="list-page">
      <div class="title-row">
        <h1>文法 <span class="sub">${grammar.length} 項</span></h1>
        <a class="button" href="#/edit/grammar/new">新增文法</a>
      </div>
      <ul class="grammar">
        ${grammar.map((g) => `<li><a href="#/grammar/${encodeURIComponent(g.id)}">
          <span class="g-title" lang="ja">${esc(g.title)}</span>
          <span class="g-meaning">${esc(g.meaning)}</span>
          <span class="g-level">N${esc(g.jlpt)}</span>
        </a></li>`).join('') || '<li class="empty">還沒有文法。</li>'}
      </ul>
      <p class="more"><a href="#/sentences">所有例句（${sCount} 句）</a></p>
    </section>`;
}

function renderGrammarDetail(id) {
  const g = state.exercises.grammarById[id];
  if (!g) { location.hash = '#/grammar'; return; }
  const sentences = (state.content.sentences || []).filter((s) => String(s.grammar || '').trim() === id);
  $view.innerHTML = `
    <section class="detail">
      <div class="title-row">
        <a href="#/grammar" class="back">文法列表</a>
        <a href="#/edit/grammar/${encodeURIComponent(id)}" class="button">編輯</a>
      </div>
      <h1 lang="ja">${esc(g.title)}</h1>
      <p class="pattern" lang="ja">${esc(g.pattern)}</p>
      <p class="meaning">${esc(g.meaning)}</p>
      <p>${esc(g.explanation)}</p>
      <div class="title-row">
        <h2>例句</h2>
        <a href="#/edit/sentences/new?grammar=${encodeURIComponent(id)}" class="button">新增例句</a>
      </div>
      ${sentenceListHtml(sentences, '還沒有例句。')}
    </section>`;
}

export function sentenceListHtml(sentences, emptyText) {
  if (!sentences.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return `<ul class="examples">${sentences.map((s) => {
    const tokens = parseSentence(s.jp);
    return `<li>
      <a class="s-link" href="#/edit/sentences/${encodeURIComponent(s.id)}" aria-label="編輯例句">
        <p class="sentence" lang="ja">${sentenceHtml(tokens, { furigana: state.settings.furigana, reveal: true, blank: -1 })}</p>
        <p class="translation">${esc(s.zh)}</p>
      </a>
      ${speakBtn(tokensReading(tokens))}
    </li>`;
  }).join('')}</ul>`;
}

/* ---------- 設定 ---------- */

async function renderSettings() {
  const s = state.settings;
  const user = cloud.currentUser();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const lastSync = await db.get('lastSync', 0);
  const pending = (await db.unsyncedLogs()).length;

  $view.innerHTML = `
    <section class="settings">
      <h1>設定</h1>

      <h2>帳號</h2>
      <p class="help">已登入：${esc(user?.email || '')}</p>
      <p class="status" id="sync-status">上次同步：${relativeTime(lastSync)}${pending ? `，還有 ${pending} 筆紀錄等待上傳` : ''}</p>
      <div class="row wrap">
        <button type="button" id="sync" class="primary">立即同步</button>
        <button type="button" id="logout">登出</button>
      </div>

      <h2>學習</h2>
      <div class="stack">
        <label>每天最多學幾題新的
          <input id="newLimit" type="number" min="1" max="100" inputmode="numeric" value="${s.newLimit}">
        </label>
        <label class="switch">
          <input id="furigana" type="checkbox" ${s.furigana ? 'checked' : ''}>
          <span>在例句和活用題上顯示振假名</span>
        </label>
      </div>

      <h2>資料</h2>
      <p class="help">教材和學習紀錄都存在雲端，這台裝置上另有一份副本，沒網路時也能學習。${persisted ? '' : '瀏覽器可能在空間不足時清掉副本，重新登入就會從雲端下載回來。'}</p>
      <div class="row wrap">
        <button type="button" id="export">匯出備份</button>
        <label class="button file">匯入備份<input type="file" id="import" accept="application/json" hidden></label>
        <button type="button" id="reset" class="danger">清除學習紀錄</button>
      </div>

      <p class="version">日語帳 ${APP_VERSION}，這台裝置：${esc(deviceName())}</p>
    </section>`;

  const status = document.getElementById('sync-status');
  document.getElementById('sync').onclick = async () => {
    status.textContent = '同步中…';
    const r = await runSync();
    status.textContent = r ? '同步完成。' : state.lastSyncError;
  };
  document.getElementById('logout').onclick = async () => {
    const left = (await db.unsyncedLogs()).length;
    if (left && navigator.onLine) await runSync({ quiet: true });
    const still = (await db.unsyncedLogs()).length;
    const msg = still
      ? `還有 ${still} 筆學習紀錄沒有上傳，登出後會遺失。確定要登出？`
      : '登出後，這台裝置上的資料會清除；重新登入就會從雲端下載回來。';
    if (!confirm(msg)) return;
    await cloud.signOut();
    await db.clearAccountData();
    await loadAll();
    showLogin();
  };
  document.getElementById('newLimit').onchange = (e) => {
    const n = Math.min(100, Math.max(1, Number(e.target.value) || 15));
    e.target.value = n;
    saveSettings({ newLimit: n });
  };
  document.getElementById('furigana').onchange = (e) => saveSettings({ furigana: e.target.checked });

  document.getElementById('export').onclick = async () => {
    const data = {
      app: 'nihongo-pwa', version: 2, exportedAt: new Date().toISOString(),
      content: { words: state.content.words, grammar: state.content.grammar, sentences: state.content.sentences },
      logs: await db.allLogs(),
      settings: { newLimit: state.settings.newLimit, furigana: state.settings.furigana },
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `日語帳備份-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById('import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'nihongo-pwa' || !Array.isArray(data.logs)) throw new Error('不是日語帳的備份檔');
      if (data.content && confirm('備份裡有教材。要把備份的教材合併到雲端嗎？（同編號的項目會被備份內容取代）')) {
        for (const t of ['words', 'grammar', 'sentences']) {
          if (Array.isArray(data.content[t]) && data.content[t].length) await cloud.saveItems(t, data.content[t]);
        }
      }
      // 匯入的紀錄標成未同步，下次同步時上傳（重複的會自動略過）
      await db.putLogs(data.logs.map((l) => ({ ...l, synced: 0 })));
      const all = await db.allLogs();
      const grouped = {};
      all.forEach((l) => { (grouped[l.exerciseId] ||= []).push(l); });
      await db.putReviews(Object.entries(grouped).map(([id, logs]) => replay(id, logs)));
      await runSync({ quiet: true });
      await loadAll();
      toast(`已匯入 ${data.logs.length} 筆紀錄`);
    } catch (err) {
      toast(`匯入失敗：${err.message}`);
    }
    e.target.value = '';
  };
  document.getElementById('reset').onclick = async () => {
    if (!navigator.onLine) { toast('需要網路才能清除雲端上的紀錄'); return; }
    if (!confirm('清除所有學習紀錄（雲端和每一台裝置）？教材會保留。這個動作無法復原，建議先匯出備份。')) return;
    try {
      await cloud.deleteAllLogs();
      await db.clearProgress();
      await db.set('logsCursor', 0);
      await db.set(`new:${todayKey()}`, 0);
      await loadAll();
      toast('學習紀錄已清除');
      renderSettings();
    } catch (err) {
      toast(handleCloudError(err));
    }
  };
}

/* ---------- 路由 ---------- */

export async function route() {
  // App 已經開著時點了信裡的連結：重新載入，讓啟動流程處理登入資訊
  if (/(^#|&)(access_token|error_description)=/.test(location.hash)) { location.reload(); return; }
  if (!cloud.currentUser()) { showLogin(); return; }
  const hash = location.hash || '#/';
  const [path, query = ''] = hash.split('?');
  const [, page, arg, arg2] = path.split('/');
  document.body.dataset.page = page || 'home';
  document.body.classList.remove('signed-out');
  const tabOf = { edit: arg === 'words' ? 'words' : 'grammar', sentences: 'grammar', study: 'home' };
  const current = tabOf[page] || page || 'home';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (page !== 'study' && state.session) state.session = null;

  if (!page) await renderHome();
  else if (page === 'study') state.session ? renderStudy() : (location.hash = '#/');
  else if (page === 'words') renderWords();
  else if (page === 'grammar') arg ? renderGrammarDetail(decodeURIComponent(arg)) : renderGrammarList();
  else if (page === 'sentences') renderSentenceList();
  else if (page === 'edit' && ['words', 'grammar', 'sentences'].includes(arg)) {
    renderEditor(arg, decodeURIComponent(arg2 || 'new'), new URLSearchParams(query));
  } else if (page === 'settings') await renderSettings();
  else location.hash = '#/';
  if (page !== 'study') window.scrollTo(0, 0);
}

function showLogin() {
  document.body.classList.add('signed-out');
  document.body.dataset.page = 'login';
  renderLogin({ onSignedIn: afterSignIn });
}

/** 登入後：新帳號放入示範教材，下載雲端資料 */
async function afterSignIn() {
  $view.innerHTML = '<section class="home"><p class="lead-small">正在下載你的教材…</p></section>';
  try {
    const seeded = await cloud.seedIfEmpty(SEED);
    if (seeded) toast('已放入 N5 示範教材，可以在「單字」「文法」分頁修改');
  } catch (e) {
    toast(handleCloudError(e));
  }
  await runSync({ quiet: true });
  await loadAll();
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else await route();
}

/* ---------- Service Worker ---------- */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => toast('有新版本', {
      action: '更新', sticky: true, onAction: () => worker.postMessage('skipWaiting'),
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => { /* 本機檔案或不支援時忽略 */ });
  // 第一次安裝時 Service Worker 也會接管頁面，那時不需要重新整理
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}

/* ---------- 啟動 ---------- */

(async function init() {
  registerSW();
  if (!cloud.isConfigured()) {
    document.body.classList.add('signed-out');
    renderSetupNeeded();
    return;
  }
  const redirect = await cloud.handleAuthRedirect();
  await cloud.loadSession();
  await loadAll();
  window.addEventListener('hashchange', route);
  requestPersistence();
  window.addEventListener('online', () => { if (cloud.currentUser()) runSync({ quiet: true }); });

  if (redirect && redirect.type === 'error') toast(redirect.message, { sticky: true, action: '好', onAction: () => {} });
  if (redirect && redirect.type === 'recovery' && cloud.currentUser()) {
    document.body.classList.add('signed-out');
    renderNewPassword({ onDone: afterSignIn });
    return;
  }
  if (redirect && redirect.type !== 'error' && cloud.currentUser()) { await afterSignIn(); return; }

  await route();
  if (cloud.currentUser()) {
    const first = !(state.content.words || []).length;
    runSync({ quiet: true }).then((r) => {
      if (r && !state.session && (first || r.contentUpdated || r.pulled)) route();
    });
  }
})();
