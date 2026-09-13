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
    note: r.note ?? '',
    date: r.date,
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
    note: r.note ?? '',
    date: r.date,
    month: String(r.date).slice(0, 7),
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

const TABLES = [
  { store: 'transactions', table: 'transactions', toRemote: txToRemote, fromRemote: txFromRemote },
  { store: 'categories', table: 'categories', toRemote: catToRemote, fromRemote: catFromRemote },
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
      await setSetting('sync.cursor.transactions', null)
      await setSetting('sync.cursor.categories', null)
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
