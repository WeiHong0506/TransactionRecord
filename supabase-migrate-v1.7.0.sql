-- ============================================================
-- 记账本 v1.7.0 多货币迁移
--
-- 在 Supabase 后台 → SQL Editor → New query，整段贴进去 Run。
-- 只加两个列，不动任何一行既有数据，可以重复执行。
--
-- 关于 default 'MYR'：迁移之前全库只有一种货币，就是你设置里那一个。
-- 给默认值是为了让所有历史行自动获得正确的货币，而不是留 NULL
-- 让应用去猜。你如果当初用的不是马币，把下面两处 'MYR' 改成你的货币代码
-- （CNY / SGD / USD …）再执行。
-- ============================================================

-- ---------- 1. 流水：记住每笔当初是用什么钱付的 ----------
alter table public.transactions
  add column if not exists currency text not null default 'MYR';

-- ---------- 2. 账户：一个账户只持有一种货币 ----------
alter table public.accounts
  add column if not exists currency text not null default 'MYR';


-- ============================================================
-- 验证。下面三句依次检查：列加上了没、历史行有没有被正确标记、
-- 以及 RLS 还在不在（RLS 是这套数据唯一的安全边界，必须是 true）。
-- ============================================================

-- 2-1. 两个 currency 列都应该出现，is_nullable = NO
select table_name, column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('transactions', 'accounts')
  and column_name = 'currency'
order by table_name;

-- 2-2. 每种货币各有多少行。迁移刚跑完时应该只有一行 MYR，
--      数字等于你现有的记录数；不该出现 null。
select 'transactions' as source, currency, count(*) as rows
from public.transactions
group by currency
union all
select 'accounts', currency, count(*)
from public.accounts
group by currency
order by source, currency;

-- 2-3. 三张表的 rls_enabled 必须全是 true
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('transactions', 'categories', 'accounts');
