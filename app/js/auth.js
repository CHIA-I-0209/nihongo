// 登入、註冊、重設密碼畫面
import * as cloud from './cloud.js';
import { esc } from './furigana.js';
import { $view, toast } from './ui.js';

const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 6a26 26 0 1 1-18.4 7.6" fill="none" stroke="var(--pen)" stroke-width="3.2" stroke-linecap="round"/>
</svg>`;

export function renderSetupNeeded() {
  $view.innerHTML = `
    <section class="auth">
      <div class="brand">${LOGO}<span lang="ja">語</span></div>
      <h1>還差一步：連接 Supabase</h1>
      <p>這個版本的資料存在 Supabase。請打開 <code>app/config.js</code>，填入你的 Supabase 專案網址和 Publishable key，再重新上傳到 GitHub。</p>
      <p class="help">詳細步驟在 README 的「設定 Supabase」。</p>
    </section>`;
}

/**
 * 登入／註冊畫面
 * mode: 'signin' | 'signup' | 'reset'
 */
export function renderLogin({ onSignedIn, mode = 'signin', email = '' }) {
  const titles = { signin: '登入', signup: '建立帳號', reset: '重設密碼' };
  const intro = {
    signin: '登入後，手機和電腦會看到同一份教材和學習進度。',
    signup: '用電子郵件建立帳號。第一次登入時會自動放入 N5 示範教材。',
    reset: '輸入註冊時的電子郵件，我們會寄一封重設密碼的信給你。',
  };
  $view.innerHTML = `
    <section class="auth">
      <div class="brand">${LOGO}<span lang="ja">語</span></div>
      <h1>${titles[mode]}</h1>
      <p class="help">${intro[mode]}</p>
      <form id="auth-form" class="stack" novalidate>
        <label>電子郵件
          <input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required value="${esc(email)}">
        </label>
        ${mode === 'reset' ? '' : `
        <label>密碼
          <input name="password" type="password" minlength="6" required
            autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"
            ${mode === 'signup' ? 'placeholder="至少 6 個字元"' : ''}>
        </label>`}
        <p class="form-error" id="auth-error" role="alert" hidden></p>
        <button type="submit" class="primary big">${{ signin: '登入', signup: '建立帳號', reset: '寄出重設信' }[mode]}</button>
      </form>
      <div class="auth-links">
        ${mode !== 'signin' ? '<button type="button" class="link" data-mode="signin">已經有帳號，登入</button>' : ''}
        ${mode !== 'signup' ? '<button type="button" class="link" data-mode="signup">建立新帳號</button>' : ''}
        ${mode === 'signin' ? '<button type="button" class="link" data-mode="reset">忘記密碼</button>' : ''}
      </div>
    </section>`;

  const form = document.getElementById('auth-form');
  const err = document.getElementById('auth-error');
  const showError = (m) => { err.textContent = m; err.hidden = false; };
  $view.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => renderLogin({ onSignedIn, mode: b.dataset.mode, email: form.email.value.trim() });
  });
  setTimeout(() => (form.email.value ? form.password : form.email)?.focus({ preventScroll: true }), 50);

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = form.email.value.trim();
    const password = form.password ? form.password.value : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('請輸入正確的電子郵件'); form.email.focus(); return; }
    if (mode !== 'reset' && password.length < 6) { showError('密碼至少要 6 個字元'); form.password.focus(); return; }
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '請稍候…';
    try {
      if (mode === 'signin') {
        await cloud.signIn(email, password);
        await onSignedIn();
      } else if (mode === 'signup') {
        const r = await cloud.signUp(email, password);
        if (r.signedIn) { await onSignedIn(); return; }
        renderCheckEmail({ onSignedIn, email, kind: 'confirm' });
      } else {
        await cloud.sendPasswordReset(email);
        renderCheckEmail({ onSignedIn, email, kind: 'reset' });
      }
    } catch (ex) {
      showError(ex.message);
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

function renderCheckEmail({ onSignedIn, email, kind }) {
  $view.innerHTML = `
    <section class="auth">
      <div class="brand">${LOGO}<span lang="ja">語</span></div>
      <h1>去收信</h1>
      <p>已經寄信到 <strong>${esc(email)}</strong>。</p>
      <p>${kind === 'confirm'
        ? '點信裡的確認連結後，回到這裡用剛才的電子郵件和密碼登入。'
        : '點信裡的連結，就可以設定新密碼。'}</p>
      <p class="help">沒收到的話，看看垃圾郵件匣。在 iPhone 上，連結會用 Safari 開啟；確認完成後回到主畫面的 App 登入就可以了。</p>
      <button type="button" class="primary big" id="back">回到登入</button>
    </section>`;
  document.getElementById('back').onclick = () => renderLogin({ onSignedIn, mode: 'signin', email });
}

export function renderNewPassword({ onDone }) {
  $view.innerHTML = `
    <section class="auth">
      <div class="brand">${LOGO}<span lang="ja">語</span></div>
      <h1>設定新密碼</h1>
      <form id="pw-form" class="stack" novalidate>
        <label>新密碼
          <input name="password" type="password" autocomplete="new-password" minlength="6" placeholder="至少 6 個字元" required>
        </label>
        <p class="form-error" id="pw-error" role="alert" hidden></p>
        <button type="submit" class="primary big">儲存新密碼</button>
      </form>
    </section>`;
  const form = document.getElementById('pw-form');
  const err = document.getElementById('pw-error');
  form.password.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (form.password.value.length < 6) { err.textContent = '密碼至少要 6 個字元'; err.hidden = false; return; }
    try {
      await cloud.updatePassword(form.password.value);
      toast('密碼已更新');
      await onDone();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  };
}
