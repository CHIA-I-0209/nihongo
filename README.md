# 日語帳 雲端版

記日文單字、練文法的 PWA。這個版本把資料和程式都放在網路上，全部使用免費方案：

| 放什麼 | 放在哪裡 | 為什麼選它 |
|---|---|---|
| 教材、學習紀錄、帳號 | **Supabase**（免費方案） | 真正的資料庫（PostgreSQL），內建帳號登入和權限控管，免費額度對個人使用綽綽有餘 |
| 程式碼 | **GitHub**（公開 repository） | 有版本紀錄，改壞了可以還原 |
| 網站 | **GitHub Pages** | 跟程式碼在同一個地方，推送後自動發布，有 HTTPS |

和第一版（Google 試算表）比起來：

- 用電子郵件和密碼登入，手機和電腦自動同步
- **直接在 App 裡新增、修改、刪除**單字、文法、例句，有即時預覽（動詞會顯示活用結果，讓你確認種類選對了）
- 每個帳號各自有一份教材和進度，可以分享給朋友用，彼此看不到對方的資料
- 沒網路時照樣能學習，紀錄等連上網路後自動上傳

---

## 設定步驟（約 20 分鐘，只需要瀏覽器）

### 1. 建立 Supabase 專案

1. 到 <https://supabase.com>，按「Start your project」，用 GitHub 帳號登入最方便（先做第 3 步註冊 GitHub 也可以）
2. 「New project」：
   - Name：`nihongo`
   - Database Password：按「Generate a password」，**存在密碼管理工具裡**（App 用不到，但之後管理資料庫可能需要）
   - Region：選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，離台灣比較近
   - 方案選 Free
3. 等一兩分鐘專案建立完成

### 2. 建立資料表

1. 左側選單「**SQL Editor**」→「New query」
2. 打開這個專案的 `supabase/schema.sql`，**全部複製**貼進去
3. 按右下角「**Run**」，看到 `Success. No rows returned` 就完成了
4. 左側「Table Editor」應該會看到 `words`、`grammar`、`sentences`、`review_logs` 四張表

這份 SQL 也設定好了權限：每個帳號只能讀寫自己的資料，沒登入的人什麼都讀不到。

### 3. 把程式碼放上 GitHub

1. 到 <https://github.com> 註冊帳號（已經有就跳過）
2. 右上角「+」→「New repository」
   - Repository name：`nihongo`
   - 選 **Public**（免費方案的 GitHub Pages 需要公開的 repository；程式碼公開沒關係，資料在 Supabase 受權限保護）
   - 按「Create repository」
3. 在新 repository 頁面點「**uploading an existing file**」
4. 解壓縮這個專案，把裡面的 `app`、`supabase`、`data`、`tools` 資料夾和 `README.md` **拖進網頁**，按「Commit changes」
5. 上傳自動發布設定（Mac 的 Finder 會隱藏 `.github` 資料夾，所以用建立檔案的方式比較保險）：
   - 「Add file」→「Create new file」
   - 檔名輸入 `.github/workflows/deploy.yml`（打 `/` 會自動變成資料夾）
   - 內容貼上專案裡 `.github/workflows/deploy.yml` 的全部內容
   - 按「Commit changes」

### 4. 填入 Supabase 連線資訊

1. 回到 Supabase：
   - **Project URL**：專案首頁上方的「Connect」按鈕，或「Project Settings → Data API」，長得像 `https://abcdefghijkl.supabase.co`
   - **Publishable key**：「Project Settings → API Keys」，以 `sb_publishable_` 開頭。（較舊的專案只有 `anon` `public` key，用那個也可以）
   - ⚠️ **不要**用 `secret` 或 `service_role` key，那把鑰匙可以繞過所有權限
2. 在 GitHub 打開 `app/config.js` → 右上角鉛筆圖示編輯：

   ```js
   export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_xxxxxxxxxxxx';
   ```

3. 按「Commit changes」

### 5. 開啟 GitHub Pages

1. GitHub repository →「Settings」→ 左側「Pages」
2. 「Build and deployment」的 Source 選 **GitHub Actions**
3. 到「Actions」分頁，等「發布到 GitHub Pages」出現綠色勾勾（約 1 分鐘）。如果還沒開始跑，點進去按「Run workflow」
4. 網址會是 `https://你的帳號.github.io/nihongo/`

### 6. 設定登入的網址

回到 Supabase：「Authentication」→「URL Configuration」

- Site URL：填上一步的網址，例如 `https://你的帳號.github.io/nihongo/`
- Redirect URLs：按「Add URL」，同樣填這個網址

這樣確認信和重設密碼信裡的連結才會帶你回到 App。

### 7. 註冊並安裝到手機

1. 用電腦打開網址 →「建立新帳號」→ 去信箱點確認連結 → 回到 App 登入
2. 第一次登入會自動放入 N5 示範教材（40 個單字、8 個文法、16 個例句）
3. 手機安裝：
   - **iPhone**：用 Safari 開網址 →「分享」→「加入主畫面」，從主畫面開啟後登入
   - **Android**：用 Chrome 開網址 →「安裝應用程式」

### 8. （建議）關閉公開註冊

網站是公開的，任何人都能註冊帳號、用掉你的免費額度。自己（和想分享的朋友）註冊完之後：

Supabase「Authentication」→「Sign In / Providers」→ 關掉「**Allow new users to sign up**」

已經註冊的帳號不受影響。

---

## 日常使用

### 新增教材

- **單字**：「單字」分頁 →「新增單字」。讀音欄可以直接打羅馬拼音。選動詞時，下方預覽會顯示ます形、て形等變化，**如果變化不對，代表動詞種類選錯了**（例如 帰る、走る、入る 是五段，不是一段）
- **文法**：「文法」分頁 →「新增文法」
- **例句**：在文法說明頁按「新增例句」。打完句子後，**選取文字**再按按鈕：
  - 「加振假名」：`{漢字|}`，在 `|` 後面填讀音
  - 「助詞挖空」：`[[p:を]]`，會出助詞選擇題
  - 「文法挖空」：`[[g:食べました|]]`，在 `|` 後面填提示（例如原形 `食べる`）

  例句用到哪些單字會自動判斷，學過那些字之後才會出這句的題目。

點列表裡的任何項目都可以修改或刪除。編輯教材需要網路。

### 大量匯入

要一次加很多單字，可以在 Supabase「Table Editor」→ `words` →「Insert」→「Import data from CSV」。CSV 欄位用：

```
id,kanji,kana,meaning,pos,verb_class,jlpt,false_friend,note,sort
w101,読む,よむ,讀,verb,godan,5,false,,1010
```

匯入時要多一欄 `user_id`，填你的帳號 ID（Supabase「Authentication」→「Users」可以看到）。`pos` 可填 `noun` `verb` `i-adj` `na-adj` `adv` `expr`；`verb_class` 可填 `godan` `ichidan` `suru` `kuru`（非動詞留空）。

### 修改程式

在 GitHub 網頁上編輯任何檔案並 commit，約一分鐘後網站就會更新。手機下次開 App 時會出現「有新版本」，點「更新」即可。（發布時會自動更新離線快取的版本號，不用自己改 `sw.js`。）

---

## 免費方案要注意的事

- **Supabase 免費專案一週沒有使用會自動暫停。** 暫停期間 App 仍可離線學習，但無法同步。到 Supabase 後台按「Restore project」就會恢復，資料不會遺失。每天有在用就不會暫停
- Supabase 免費額度：資料庫 500 MB（文字教材加上幾十萬筆紀錄都用不完）、每月 5 GB 流量
- Supabase 內建寄信功能每小時只能寄少量的信，個人使用沒問題；如果很多朋友同時註冊可能會被擋，過一小時再試即可
- GitHub Pages 免費方案需要公開的 repository。程式碼公開沒有安全問題：`config.js` 裡的 publishable key 本來就是設計給前端用的，資料由資料庫權限保護
- 免費方案的規則可能會變，以官方的價格頁為準

## 檔案結構

```
.github/workflows/deploy.yml  推送後自動發布到 GitHub Pages
supabase/schema.sql           資料表與權限，貼到 Supabase SQL Editor 執行
app/                          PWA 本體（發布的就是這個資料夾）
  config.js                   ← 填 Supabase 網址和 key
  index.html, styles.css, sw.js, manifest.webmanifest, icons/
  js/
    main.js       畫面流程、學習、設定
    auth.js       登入、註冊、重設密碼
    editor.js     新增／修改教材
    cloud.js      連接 Supabase（登入與資料存取）
    exercises.js  從教材產生題目
    conjugate.js  活用規則
    fsrs.js       間隔重複排程
    kana.js       羅馬拼音轉假名
    furigana.js   例句格式與振假名
    db.js         手機本機的資料庫（IndexedDB）
    ui.js, device.js, seed.js
data/seed.json                新帳號的示範教材
tools/build.mjs               改完 seed.json 後產生 app/js/seed.js
```

## 資料怎麼同步

- 教材：雲端是主檔。在 App 裡編輯會直接寫進 Supabase，其他裝置下次同步時下載
- 學習紀錄：作答時先存在裝置上，每回合結束、開啟 App、恢復網路時上傳。紀錄只新增不修改，每台裝置從完整紀錄計算複習排程，所以多台裝置交替使用也不會互相覆蓋
- 登出會清除這台裝置上的副本，重新登入就會從雲端下載回來
