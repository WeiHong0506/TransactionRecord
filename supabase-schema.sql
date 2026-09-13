-- ============================================================
-- 记账本 · Supabase 建表脚本
-- 在 Supabase 控制台 → SQL Editor → New query 里整段粘贴执行
-- 可以重复执行，不会破坏已有数据
-- ============================================================

-- ---------- 流水 ----------
create table if not exists public.transactions (
  id          text        primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  type        text        not null check (type in ('expense', 'income')),
  amount      numeric(14, 2) not null,
  category_id text        not null,
  note        text        not null default '',
  date        date        not null,
  created_at  timestamptz not null default now(),
  -- 同步用：客户端写入时间，冲突时「后写优先」比的就是它
  updated_at  timestamptz not null default now(),
  -- 软删除墓碑：删除不是真删行，否则另一台设备永远不知道这条被删了
  deleted_at  timestamptz
);

-- ---------- 分类 ----------
create table if not exists public.categories (
  id         text        primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null,
  icon       text        not null default '✨',
  type       text        not null check (type in ('expense', 'income')),
  slot       smallint    not null default 0,
  "order"    integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- 增量拉取用的索引 ----------
-- 每次同步只查 updated_at 大于上次同步时间的行，数据多了也快
create index if not exists transactions_user_updated_idx
  on public.transactions (user_id, updated_at);
create index if not exists categories_user_updated_idx
  on public.categories (user_id, updated_at);

-- ============================================================
-- 行级安全策略（RLS）
--
-- 这是整套方案的安全基石：anon key 是公开的，任何人都能拿到，
-- 但有了下面的策略，每个人只能读写 user_id 等于自己的那些行。
-- 没有 RLS = 任何人都能读走所有人的账本。务必确认执行成功。
-- ============================================================

alter table public.transactions enable row level security;
alter table public.categories   enable row level security;

-- 重复执行时先清掉旧策略，避免报重名错
drop policy if exists "own transactions" on public.transactions;
drop policy if exists "own categories"   on public.categories;

create policy "own transactions" on public.transactions
  for all
  using      (auth.uid() = user_id)   -- 能看到哪些行
  with check (auth.uid() = user_id);  -- 能写入哪些行

create policy "own categories" on public.categories
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 验证：下面这句应该两行都返回 true
-- ============================================================
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('transactions', 'categories');
