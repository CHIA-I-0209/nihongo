// 匯入範例包：讀取範例包檔案（JSON）→ 檢查 → 預覽 → 寫入雲端
// 以後新增範例包只要給 App 一個檔案，不用改程式。
import * as cloud from './cloud.js';
import { db } from './db.js';
import { esc } from './furigana.js';
import { parsePack, planImport, MAX_TEXT, NOUN } from './packfile.js';
import { state, $view, toast } from './ui.js';
import { loadAll, runSync } from './main.js';

/** 寫入雲端，排在你現有教材的後面 */
export async function applyImport(plan) {
  for (const t of ['words', 'grammar', 'sentences']) {
    if (!plan[t].length) continue;
    let sort = Math.max(0, ...(state.content[t] || []).map((x) => Number(x.sort) || 0));
    await cloud.saveItems(t, plan[t].map((x) => ({ ...x, sort: (sort += 10) })));
  }
  const log = await db.get('importedPacks', []);
  await db.set('importedPacks', [...log, { at: Date.now() }].slice(-50));
  await runSync({ quiet: true });
  await loadAll();
}

/* ---------- 畫面 ---------- */

export function renderImport() {
  $view.innerHTML = `
    <section class="editor import">
      <a href="#/grammar" class="back">文法列表</a>
      <h1>匯入範例包</h1>
      <p class="help">範例包是一個 <code>.json</code> 檔，裡面有單字、文法和例句。選擇檔案，或把檔案內容整段貼上。已經有的項目會自動略過，不會重複。</p>
      <div class="stack">
        <label class="button file big">選擇範例包檔案<input type="file" id="pack-file" accept=".json,application/json,text/plain" hidden></label>
        <details class="paste-box" id="paste-box">
          <summary>改用貼上</summary>
          <textarea id="pack-text" rows="6" spellcheck="false" autocapitalize="off" placeholder='{ "format": "nihongo-pack", ... }'></textarea>
          <button type="button" id="pack-check">檢查內容</button>
        </details>
      </div>
      <p class="form-error" id="import-error" role="alert" hidden></p>
      <div id="import-preview" aria-live="polite"></div>
    </section>`;

  const err = document.getElementById('import-error');
  const preview = document.getElementById('import-preview');
  const showError = (m) => { err.textContent = m; err.hidden = false; preview.innerHTML = ''; };

  const load = (text) => {
    err.hidden = true;
    let parsed;
    try { parsed = parsePack(text); } catch (e) { showError(e.message); return; }
    renderPreview(parsed, preview, showError);
  };
  document.getElementById('pack-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_TEXT) { showError('檔案太大（超過 3 MB）'); return; }
    load(await file.text());
    e.target.value = '';
  };
  document.getElementById('pack-check').onclick = () => load(document.getElementById('pack-text').value);
}

function renderPreview({ pack, problems }, el, showError) {
  const plan = planImport(pack, state.content);
  const add = { words: plan.words.length, grammar: plan.grammar.length, sentences: plan.sentences.length };
  const total = add.words + add.grammar + add.sentences;
  const bad = problems.filter((p) => !p.soft);
  const soft = problems.filter((p) => p.soft);
  const row = (t) => `<tr><th>${NOUN[t]}</th><td>${add[t]}</td><td>${plan.skipped[t].length}</td><td>${bad.filter((p) => p.table === t).length}</td></tr>`;
  const skippedList = ['words', 'grammar', 'sentences'].flatMap((t) => plan.skipped[t].map((x) => ({ t, ...x })));
  el.innerHTML = `
    <div class="pack import-card">
      <p class="pack-title">${esc(pack.title)}</p>
      ${pack.description ? `<p class="pack-desc">${esc(pack.description)}</p>` : ''}
      <table class="import-table">
        <thead><tr><th></th><th>新增</th><th>已有，略過</th><th>格式有誤</th></tr></thead>
        <tbody>${['grammar', 'sentences', 'words'].filter((t) => pack[t].length || bad.some((p) => p.table === t)).map(row).join('')}</tbody>
      </table>
      ${plan.grammar.length ? `<p class="help">新增的文法：<span lang="ja">${plan.grammar.slice(0, 12).map((g) => esc(g.title)).join('、')}${plan.grammar.length > 12 ? ` 等 ${plan.grammar.length} 項` : ''}</span></p>` : ''}
      ${bad.length ? `<details class="import-details" open><summary>有 ${bad.length} 項格式有誤，不會匯入</summary><ul>${bad.map((p) => `<li>${esc(p.where)}：${esc(p.reason)}</li>`).join('')}</ul></details>` : ''}
      ${soft.length ? `<details class="import-details"><summary>${soft.length} 個提醒</summary><ul>${soft.map((p) => `<li>${esc(p.where)}：${esc(p.reason)}</li>`).join('')}</ul></details>` : ''}
      ${skippedList.length ? `<details class="import-details"><summary>${skippedList.length} 項已經有了，會略過</summary><ul>${skippedList.slice(0, 100).map((x) => `<li><span lang="ja">${esc(x.name)}</span>：${esc(x.reason)}</li>`).join('')}</ul></details>` : ''}
      <div class="row">
        ${total
          ? `<button type="button" class="primary" id="do-import">匯入 ${total} 項</button>`
          : '<p class="help">這個範例包的內容你都已經有了，不需要匯入。</p>'}
      </div>
    </div>`;
  document.getElementById('do-import')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '匯入中…';
    try {
      await applyImport(plan);
      const parts = [];
      if (add.grammar) parts.push(`${add.grammar} 項文法`);
      if (add.sentences) parts.push(`${add.sentences} 句例句`);
      if (add.words) parts.push(`${add.words} 個單字`);
      toast(`已匯入「${pack.title}」：${parts.join('、')}`);
      location.hash = '#/grammar';
    } catch (ex) {
      showError(ex.code === 'network' ? '需要網路才能匯入範例包，請連上網路後再試' : ex.message);
      btn.disabled = false;
      btn.textContent = `匯入 ${total} 項`;
    }
  });
}
