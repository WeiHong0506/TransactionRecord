-- ============================================================
-- 备用：直接在云端插入「旅行」分类
--
-- 正常情况下你不需要跑这个。分类是数据不是表结构，应用升级到 v1.8.4 后
-- 本机会自动建好这一行并标记为待上传，下次同步就推到云端了。
--
-- 只有这些情况才用得上：
--   · 你想让其他设备立刻拿到，而这台设备暂时打不开
--   · 同步出了问题，想手动补一行
--
-- 用法：Supabase 后台 → SQL Editor → New query → 整段贴进去 Run。
-- 先把下面的邮箱换成你登录云端同步用的那个 Google 邮箱。
-- ============================================================

insert into public.categories (id, user_id, name, icon, type, slot, "order", created_at, updated_at, deleted_at)
select
  'exp-travel',          -- id 必须是这个：应用按 id 认分类，写别的会变成两个「旅行」
  u.id,
  '旅行',
  '✈️',
  'expense',
  6,                     -- 色槽，和「日用」共用：旅行只在出行月份冒头，两者不会同时挤进前几名
  10,                    -- 排在「通讯」之后
  now(),
  now(),
  null                   -- 非空的话应用会当它是已删除的
from auth.users u
where u.email = '换成你的邮箱@gmail.com'
on conflict (id) do update set
  name       = excluded.name,
  icon       = excluded.icon,
  type       = excluded.type,
  slot       = excluded.slot,
  "order"    = excluded."order",
  deleted_at = null,           -- 之前删过的话，这一句会把它复活
  updated_at = now();

-- 「其他」让位排到最后
update public.categories c
set "order" = 11, updated_at = now()
from auth.users u
where c.user_id = u.id
  and u.email = '换成你的邮箱@gmail.com'
  and c.id = 'exp-other'
  and c."order" = 10;


-- ============================================================
-- 验证：应该看到「旅行」在「通讯」之后、「其他」之前
-- ============================================================
select c."order", c.id, c.name, c.icon, c.slot, c.deleted_at
from public.categories c
join auth.users u on u.id = c.user_id
where u.email = '换成你的邮箱@gmail.com'
  and c.type = 'expense'
order by c."order";
