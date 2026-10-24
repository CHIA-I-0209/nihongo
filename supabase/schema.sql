-- 日語帳 雲端版：資料庫結構
-- 在 Supabase 後台「SQL Editor」→ New query，貼上全部內容後按 Run。
-- 可以重複執行，不會刪掉已有資料。
--
-- 每個登入的帳號各自擁有一份教材和學習紀錄，
-- Row Level Security（RLS）保證只能讀寫自己的資料。

-- ---------- 單字 ----------
create table if not exists public.words (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null,
  kanji        text not null default '',
  kana         text not null,
  meaning      text not null default '',
  pos          text not null default 'noun'
               check (pos in ('noun', 'verb', 'i-adj', 'na-adj', 'adv', 'expr')),
  verb_class   text not null default ''
               check (verb_class in ('', 'godan', 'ichidan', 'suru', 'kuru')),
  jlpt         smallint not null default 5 check (jlpt between 1 and 5),
  false_friend boolean not null default false,
  note         text not null default '',
  sort         integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------- 文法 ----------
create table if not exists public.grammar (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null,
  title       text not null,
  pattern     text not null default '',
  meaning     text not null default '',
  explanation text not null default '',
  jlpt        smallint not null default 5 check (jlpt between 1 and 5),
  sort        integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------- 例句 ----------
-- jp 欄位格式：{漢字|かな} 振假名、[[p:を]] 助詞挖空、[[g:答案|提示]] 文法挖空
create table if not exists public.sentences (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  jp         text not null,
  zh         text not null default '',
  words      text not null default '',   -- 用到的單字 id，逗號分隔
  grammar    text not null default '',   -- 對應的文法 id
  sort       integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------- 學習紀錄（只新增、不修改） ----------
create table if not exists public.review_logs (
  seq         bigint generated always as identity primary key,
  id          uuid not null unique,         -- App 產生，避免重複上傳
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id text not null,
  rating      smallint not null check (rating between 1 and 4),
  reviewed_at bigint not null,              -- 毫秒時間戳
  device      text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists review_logs_user_seq on public.review_logs (user_id, seq);

-- ---------- 自動更新 updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['words', 'grammar', 'sentences'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- 權限：只能存取自己的資料 ----------
do $$
declare t text;
begin
  foreach t in array array['words', 'grammar', 'sentences', 'review_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 學習紀錄不允許修改，只能新增（刪除保留給「清除紀錄」功能）
revoke update on public.review_logs from authenticated;
