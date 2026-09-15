import { supabase, syncConfigured } from './supabase.js'
import {
  clearDirty,
  getDirty,
  getSetting,
  mergeRemote,
  purgeTombstones,
  resetForNewAccount,
  setSetting,
} from './db.js'

/**
 * 本地优先的双向同步。
 *
 * 规则很简单：每条记录都带 updatedAt（客户端写入时间），冲突时后写的赢。
 * 删除不是真删，而是写一个 deletedAt 墓碑，否则另一台设备永远不知道这条被删了。
 * 本地改动打 dirty 标记，联网时推上去；拉取只取 updated_at 比上次同步更新的行。
 *
 * 设备之间时钟不同步会让「后写优先」有几秒误差。个人记账场景可以接受，
 * 代价是极端情况下同一条记录在两台设备同时编辑，可能保留较早的那次。
 */

const PAGE = 1000
// 时钟偏差保护：拉取游标往回退一点，宁可重复拉也不要漏
const CURSOR_SKEW_MS = 60_000

const toIso = (ms) => (ms ? new Date(ms).toISOString() : null)
const toMs = (iso) => (iso ? Date.parse(iso) : null)

// created_at / updated_at 在云端是非空列。历史数据可能缺字段，
// 这里兜底，绝不往上发 null——否则整批上传都会被拒。
const stampOf = (r) => toIso(r.updatedAt ?? r.createdAt ?? Date.now())
const createdOf = (r) => toIso(r.createdAt ?? r.updatedAt ?? Date.now())

/* ---------------- 本地 ↔ 云端字段映射 ---------------- */

export function txToRemote(r, userId) {
  return {
    id: r.id,
    user_id: userId,
    type: r.type,
    amount: r.amount,
    category_id: r.categoryId,
    account_id: r.accountId ?? null,
    currency: r.currency ?? 'MYR',
    note: r.note ?? '',
    date: r.date,
    recurring_id: r.recurringId ?? null,
    created_at: createdOf(r),
    updated_at: stampOf(r),
    deleted_at: toIso(r.deletedAt),
  }
}

function txFromRemote(r) {
  return {
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    categoryId: r.category_id,
    accountId: r.account_id ?? null,
    // 老设备同步上来的记录没有货币，按主货币时代的唯一货币兜底
    currency: r.currency ?? 'MYR',
    note: r.note ?? '',
    date: r.date,
    month: String(r.date).slice(0, 7),
    // 老客户端上传的流水没有这一列，缺就是 null——不是某条固定支出的实例
    recurringId: r.recurring_id ?? null,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    deletedAt: toMs(r.deleted_at),
  }
}

export function catToRemote(c, userId) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    icon: c.icon,
    type: c.type,
    slot: c.slot ?? 0,
    order: c.order ?? 0,
    created_at: createdOf(c),
    updated_at: stampOf(c),
    deleted_at: toIso(c.deletedAt),
  }
}

function catFromRemote(r) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    type: r.type,
    slot: r.slot ?? 0,
    order: r.order ?? 0,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    deletedAt: toMs(r.deleted_at),
  }
}

export function accToRemote(a, userId) {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    icon: a.icon,
    slot: a.slot ?? 0,
    initial_balance: a.initialBalance ?? 0,
    currency: a.currency ?? 'MYR',
    order: a.order ?? 0,
    created_at: createdOf(a),
    updated_at: stampOf(a),
    deleted_at: toIso(a.deletedAt),
  }
}

function accFromRemote(r) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    slot: r.slot ?? 0,
    initialBalance: Number(r.initial_balance ?? 0),
    currency: r.currency ?? 'MYR',
    order: r.order ?? 0,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    deletedAt: toMs(r.deleted_at),
  }
}

export function budgetToRemote(b, userId) {
  return {
    id: b.id,
    user_id: userId,
    amount: b.amount ?? 0,
    currency: b.currency ?? 'MYR',
    created_at: createdOf(b),
    updated_at: stampOf(b),
    deleted_at: toIso(b.deletedAt),
  }
}

function budgetFromRemote(r) {
  return {
    id: r.id,
    amount: Number(r.amount ?? 0),
    currency: r.currency ?? 'MYR',
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    deletedAt: toMs(r.deleted_at),
  }
}

export function recToRemote(r, userId) {
  return {
    id: r.id,
    user_id: userId,
    name: r.name ?? '',
    amount: r.amount ?? 0,
    currency: r.currency ?? 'MYR',
    category_id: r.categoryId ?? null,
    account_id: r.accountId ?? null,
    cycle: r.cycle === 'yearly' ? 'yearly' : 'monthly',
    day: r.day ?? 1,
    // 只有年付才有月份；每月一次的存 null，语义比存 0 清楚
    month: r.cycle === 'yearly' ? (r.month ?? 1) : null,
    active: r.active !== false,
    created_at: createdOf(r),
    updated_at: stampOf(r),
    deleted_at: toIso(r.deletedAt),
  }
}

function recFromRemote(r) {
  return {
    id: r.id,
    name: r.name ?? '',
    amount: Number(r.amount ?? 0),
    currency: r.currency ?? 'MYR',
    categoryId: r.category_id ?? null,
    accountId: r.account_id ?? null,
    cycle: r.cycle === 'yearly' ? 'yearly' : 'monthly',
    day: Number(r.day ?? 1),
    month: r.month == null ? null : Number(r.month),
    active: r.active !== false,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    deletedAt: toMs(r.deleted_at),
  }
}

// 顺序有意义：账户和分类先上传，流水引用它们
const TABLES = [
  { store: 'accounts', table: 'accounts', toRemote: accToRemote, fromRemote: accFromRemote },
  { store: 'categories', table: 'categories', toRemote: catToRemote, fromRemote: catFromRemote },
  // 固定支出排在流水前面：流水的 recurring_id 指着它
  { store: 'recurrings', table: 'recurrings', toRemote: recToRemote, fromRemote: recFromRemote },
  { store: 'transactions', table: 'transactions', toRemote: txToRemote, fromRemote: txFromRemote },
  // 预算放最后：它的 id 引用分类，分类先上去才不会出现悬空引用
  { store: 'budgets', table: 'budgets', toRemote: budgetToRemote, fromRemote: budgetFromRemote },
]

/* ---------------- 推送 ---------------- */

async function pushTable({ store, table, toRemote }, userId) {
  const dirty = await getDirty(store)
  if (!dirty.length) return 0

  for (let i = 0; i < dirty.length; i += PAGE) {
    const chunk = dirty.slice(i, i + PAGE)
    const { error } = await supabase
      .from(table)
      .upsert(chunk.map((r) => toRemote(r, userId)), { onConflict: 'id' })
    if (error) throw new Error(`上传${table}失败：${error.message}`)
    await clearDirty(store, chunk.map(({ id, updatedAt }) => ({ id, updatedAt })))
  }
  return dirty.length
}

/* ---------------- 拉取 ---------------- */

async function pullTable({ store, table, fromRemote }, since) {
  let cursor = since
  let total = 0

  for (;;) {
    let q = supabase
      .from(table)
      .select('*')
      .order('updated_at', { ascending: true })
      .limit(PAGE)
    if (cursor) q = q.gt('updated_at', cursor)

    const { data, error } = await q
    if (error) throw new Error(`拉取${table}失败：${error.message}`)
    if (!data?.length) break

    await mergeRemote(store, data.map(fromRemote))
    total += data.length
    cursor = data[data.length - 1].updated_at
    if (data.length < PAGE) break
  }

  return { count: total, cursor }
}

/* ---------------- 对外入口 ---------------- */

export async function getSession() {
  if (!syncConfigured) return null
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

export async function signInWithGoogle(redirectTo) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (error) throw new Error('登录失败：' + error.message)
}

export async function signOut() {
  await supabase.auth.signOut()
}

let running = null

/**
 * 跑一轮同步。并发调用会复用同一次执行，不会重复推拉。
 * 返回 { pushed, pulled, at }
 */
export async function runSync(userId) {
  if (!syncConfigured || !userId) return null
  if (running) return running

  running = (async () => {
    // 换账号了：先清空本地，避免把上一个账号的数据混进新账号
    const boundUser = await getSetting('sync.userId', null)
    if (boundUser && boundUser !== userId) {
      await resetForNewAccount()
      for (const spec of TABLES) await setSetting(`sync.cursor.${spec.store}`, null)
    }
    await setSetting('sync.userId', userId)

    let pushed = 0
    let pulled = 0

    for (const spec of TABLES) {
      pushed += await pushTable(spec, userId)
    }

    for (const spec of TABLES) {
      const key = `sync.cursor.${spec.store}`
      const saved = await getSetting(key, null)
      const since = saved ? toIso(Date.parse(saved) - CURSOR_SKEW_MS) : null
      const { count, cursor } = await pullTable(spec, since)
      pulled += count
      if (cursor) await setSetting(key, cursor)
    }

    const at = Date.now()
    await setSetting('sync.lastAt', at)
    await purgeTombstones()
    return { pushed, pulled, at }
  })()

  try {
    return await running
  } finally {
    running = null
  }
}

export async function getLastSyncAt() {
  return getSetting('sync.lastAt', null)
}
