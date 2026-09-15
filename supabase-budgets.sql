-- ============================================================
-- 记账本 v1.9.0 预算迁移
--
-- 在 Supabase 后台 → SQL Editor → New query，整段贴进去 Run。
-- 只新建一张表，不动任何既有数据，可以重复执行。
--
-- 为什么预算要单独一张表，而不是塞进 settings：
-- settings 不参与同步（它装的是主题、上次用的账户这类本机偏好），
-- 而预算必须跨设备一致——手机上设了、笔记本上看不到，比没有这个功能更糟。
--
-- **这一步必须排在推代码之前。** 反了的话应用会往一张不存在的表上传数据，
-- 同步直接报错。
-- ============================================================

create table if not exists public.budgets (
  -- id 不是随机 UUID，而是 'total' 或分类 id（例如 'exp-food'）。
  -- 这样同一条预算在两台设备上分别编辑时，靠 id 就能收敛成一条，
  -- 而不是各留一份、界面上出现两个「餐饮预算」。
  id         text        primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  amount     numeric(14, 2) not null default 0,
  currency   text        not null default 'MYR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists budgets_user_updated_idx
  on public.budgets (user_id, updated_at);

-- ---------- 行级安全 ----------
-- RLS 是这套数据唯一的安全边界。前端用的是 publishable key，
-- 任何人都能拿到它；能不能读到你的数据，全靠下面这条策略。
alter table public.budgets enable row level security;

drop policy if exists "own budgets" on public.budgets;

create policy "own budgets" on public.budgets
  for all
  using      (auth.uid() = user_id)   -- 能看到哪些行
  with check (auth.uid() = user_id);  -- 能写入哪些行


-- ============================================================
-- 验证
-- ============================================================

-- 1. 表建好了，列都在
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'budgets'
order by ordinal_position;

-- 2. 四张表的 rls_enabled 必须全是 true
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('transactions', 'categories', 'accounts', 'budgets');
