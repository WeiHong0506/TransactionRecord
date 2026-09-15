-- ============================================================
-- 记账本 v1.10.0 固定支出迁移
--
-- 在 Supabase 后台 → SQL Editor → New query，整段贴进去 Run。
-- 新建一张表 + 给 transactions 加一列，不动任何既有数据，可以重复执行。
--
-- **这一步必须排在推代码之前。** 反了的话应用会往一张不存在的表上传数据，
-- 同步直接报错，而且 transactions 的上传也会因为多了一列而整批被拒。
-- ============================================================

create table if not exists public.recurrings (
  id          text        primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  name        text        not null default '',
  amount      numeric(14, 2) not null default 0,
  currency    text        not null default 'MYR',
  category_id text,
  account_id  text,
  -- 'monthly' 或 'yearly'
  cycle       text        not null default 'monthly',
  -- 1–31 的原始设定。不在这里夹紧到 28——夹紧是「在某个具体月份」才有意义的事，
  -- 存成 28 的话，2 月过一次之后就再也回不到 31 号了。
  day         smallint    not null default 1,
  -- 只有 cycle='yearly' 才有值；每月一次的是 null
  month       smallint,
  -- 停用而不是删除：暂时不扣了，但历史记录还指着它
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint recurrings_day_range   check (day between 1 and 31),
  constraint recurrings_month_range check (month is null or month between 1 and 12)
);

create index if not exists recurrings_user_updated_idx
  on public.recurrings (user_id, updated_at);

-- ---------- 行级安全 ----------
-- RLS 是这套数据唯一的安全边界。前端用的是 publishable key，任何人都能拿到它；
-- 能不能读到你的数据，全靠下面这条策略。
alter table public.recurrings enable row level security;

drop policy if exists "own recurrings" on public.recurrings;

create policy "own recurrings" on public.recurrings
  for all
  using      (auth.uid() = user_id)   -- 能看到哪些行
  with check (auth.uid() = user_id);  -- 能写入哪些行


-- ---------- 流水上的来源标记 ----------
-- 「这个月房租扣过了没有」靠这一列精确回答，不靠金额猜。
-- 猜的话，一笔金额接近的普通居住支出就会被当成房租已扣，
-- 预算里少预留一千多块——这种错比不做这个功能还糟。
--
-- 故意不加外键：固定支出被硬删之后，流水本身仍然是一笔真实发生的支出，
-- 不该因为「来源没了」而连带消失或阻止删除。
alter table public.transactions
  add column if not exists recurring_id text;


-- ============================================================
-- 验证
-- ============================================================

-- 1. 表建好了，列都在
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'recurrings'
order by ordinal_position;

-- 2. transactions 上多了 recurring_id
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'transactions' and column_name = 'recurring_id';

-- 3. 五张表的 rls_enabled 必须全是 true。有一个 false 就是数据对全网公开。
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('transactions', 'categories', 'accounts', 'budgets', 'recurrings');
