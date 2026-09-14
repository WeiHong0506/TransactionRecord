import { openDB } from 'idb'
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from './categories.js'

const DB_NAME = 'transaction-record'
// v2：为云端同步增加软删除墓碑（deletedAt）和待上传标记（dirty）
// v3：补齐 createdAt——v2 漏了它，导致上传时发送 null，撞上云端的非空约束
// v4：引入资金账户，历史流水回填到默认账户
// v5：补齐后来新增的默认分类（老用户的分类表是在 v1 就建好的，不会自动拿到新分类）
// v6：货币下沉到账户和每一笔流水。在此之前货币只是个全局显示设置，
//     金额都是裸数字；迁移时按当时的设置值回填，否则改主货币会把历史记录的含义改掉
const DB_VERSION = 6

let dbPromise = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, newVersion, tx) {
        if (oldVersion < 1) {
          const t = db.createObjectStore('transactions', { keyPath: 'id' })
          t.createIndex('by-date', 'date')
          t.createIndex('by-month', 'month')
          t.createIndex('by-category', 'categoryId')
          db.createObjectStore('categories', { keyPath: 'id' })
          db.createObjectStore('settings', { keyPath: 'key' })
        }
        if (oldVersion < 3) {
          // 老数据补齐同步字段：一律当作「本地已改、待上传」
          for (const name of ['transactions', 'categories']) {
            const store = tx.objectStore(name)
            let cursor = await store.openCursor()
            while (cursor) {
              const v = cursor.value
              const stamp = v.updatedAt ?? v.createdAt ?? Date.now()
              await cursor.update({
                ...v,
                createdAt: v.createdAt ?? stamp,
                updatedAt: v.updatedAt ?? stamp,
                deletedAt: v.deletedAt ?? null,
                dirty: 1,
              })
              cursor = await cursor.continue()
            }
          }
        }
        if (oldVersion < 5 && oldVersion >= 1) {
          // 只补「缺了的」，不动用户改过或删过的分类。
          // 用户主动删掉的分类留有墓碑，这里会跳过，不会被复活。
          const store = tx.objectStore('categories')
          const existing = new Set((await store.getAll()).map((c) => c.id))
          const now = Date.now()
          for (const c of DEFAULT_CATEGORIES) {
            if (existing.has(c.id)) continue
            await store.put({ ...c, createdAt: now, updatedAt: now, deletedAt: null, dirty: 1 })
          }
        }
        if (oldVersion < 4) {
          // 资金账户。历史流水没有归属，统一回填到默认账户，
          // 否则它们会从「按账户统计」里凭空消失。
          if (!db.objectStoreNames.contains('accounts')) {
            db.createObjectStore('accounts', { keyPath: 'id' })
          }
          const now = Date.now()
          const accounts = tx.objectStore('accounts')
          for (const a of DEFAULT_ACCOUNTS) {
            await accounts.put({
              ...a,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              dirty: 1,
            })
          }
          const fallbackId = DEFAULT_ACCOUNTS[0].id
          const store = tx.objectStore('transactions')
          let cursor = await store.openCursor()
          while (cursor) {
            const v = cursor.value
            if (!v.accountId) {
              await cursor.update({ ...v, accountId: fallbackId, updatedAt: now, dirty: 1 })
            }
            cursor = await cursor.continue()
          }
        }
        if (oldVersion < 6 && oldVersion >= 1) {
          // 迁移前所有金额都是同一种货币——就是设置里那一个。按它回填，
          // 这样之后把主货币改成人民币时，历史的马币记录仍然认得自己是马币。
          const settings = tx.objectStore('settings')
          const legacy = (await settings.get('currency'))?.value ?? 'MYR'
          const now = Date.now()
          for (const name of ['accounts', 'transactions']) {
            const store = tx.objectStore(name)
            let cursor = await store.openCursor()
            while (cursor) {
              const v = cursor.value
              if (!v.currency) {
                await cursor.update({ ...v, currency: legacy, updatedAt: now, dirty: 1 })
              }
              cursor = await cursor.continue()
            }
          }
          // 主货币就是原来那个设置值，汇率表里它恒为 1
          await settings.put({ key: 'fx', value: { [legacy]: 1 } })
        }
      },
    })
  }
  return dbPromise
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

const alive = (r) => r && !r.deletedAt

/* ---------------- 分类 ---------------- */

export async function initCategories() {
  const db = await getDB()
  const existing = await db.getAll('categories')
  if (existing.length > 0) return
  const tx = db.transaction('categories', 'readwrite')
  const now = Date.now()
  await Promise.all(
    DEFAULT_CATEGORIES.map((c) =>
      tx.store.put({ ...c, createdAt: now, updatedAt: now, deletedAt: null, dirty: 1 })
    )
  )
  await tx.done
}

export async function getCategories() {
  const db = await getDB()
  const all = await db.getAll('categories')
  return all.filter(alive).sort((a, b) => a.order - b.order)
}

export async function saveCategory(category) {
  const db = await getDB()
  const now = Date.now()
  const full = {
    ...category,
    id: category.id || newId(),
    createdAt: category.createdAt ?? now,
    updatedAt: now,
    deletedAt: category.deletedAt ?? null,
    dirty: 1,
  }
  await db.put('categories', full)
  return full
}

// 软删除：保留墓碑，否则其他设备无从得知这条被删过
export async function deleteCategory(id) {
  const db = await getDB()
  const row = await db.get('categories', id)
  if (!row) return
  await db.put('categories', { ...row, deletedAt: Date.now(), updatedAt: Date.now(), dirty: 1 })
}

/* ---------------- 资金账户 ---------------- */

// 账户为空时补上默认账户（例如换云端账号后云端没有账户数据的情况）
export async function initAccounts() {
  const db = await getDB()
  const existing = await db.getAll('accounts')
  if (existing.length > 0) return
  const now = Date.now()
  const tx = db.transaction('accounts', 'readwrite')
  await Promise.all(
    DEFAULT_ACCOUNTS.map((a) =>
      tx.store.put({ ...a, createdAt: now, updatedAt: now, deletedAt: null, dirty: 1 })
    )
  )
  await tx.done
}

export async function getAccounts() {
  const db = await getDB()
  const all = await db.getAll('accounts')
  return all.filter(alive).sort((a, b) => a.order - b.order)
}

export async function saveAccount(account) {
  const db = await getDB()
  const now = Date.now()
  const full = {
    ...account,
    id: account.id || newId(),
    initialBalance: Math.round(Number(account.initialBalance || 0) * 100) / 100,
    // 账户的货币一旦定下就是它所有流水的计价单位，缺省回退到主货币
    currency: account.currency || 'MYR',
    createdAt: account.createdAt ?? now,
    updatedAt: now,
    deletedAt: account.deletedAt ?? null,
    dirty: 1,
  }
  await db.put('accounts', full)
  return full
}

// 删除账户时，它名下的流水不会被删——读取时回退显示为「未指定账户」
export async function deleteAccount(id) {
  const db = await getDB()
  const row = await db.get('accounts', id)
  if (!row) return
  const now = Date.now()
  await db.put('accounts', { ...row, deletedAt: now, updatedAt: now, dirty: 1 })
}

/* ---------------- 流水 ---------------- */

export async function saveTransaction(record) {
  const db = await getDB()
  const now = Date.now()
  const full = {
    ...record,
    id: record.id || newId(),
    month: record.date.slice(0, 7),
    amount: Math.round(Number(record.amount) * 100) / 100,
    note: record.note ?? '',
    accountId: record.accountId ?? DEFAULT_ACCOUNTS[0].id,
    // 抄一份账户的货币存下来，而不是每次回查账户：
    // 这样以后账户改名换币，历史记录仍然记得自己当初是用什么钱付的
    currency: record.currency || 'MYR',
    createdAt: record.createdAt ?? now,
    updatedAt: now,
    deletedAt: record.deletedAt ?? null,
    dirty: 1,
  }
  await db.put('transactions', full)
  return full
}

export async function deleteTransaction(id) {
  const db = await getDB()
  const row = await db.get('transactions', id)
  if (!row) return
  const now = Date.now()
  await db.put('transactions', { ...row, deletedAt: now, updatedAt: now, dirty: 1 })
}

export async function getAllTransactions() {
  const db = await getDB()
  const all = await db.getAll('transactions')
  return sortRecords(all.filter(alive))
}

export async function getTransactionsByMonth(month) {
  const db = await getDB()
  const all = await db.getAllFromIndex('transactions', 'by-month', month)
  return sortRecords(all.filter(alive))
}

function sortRecords(list) {
  return list.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}

/* ---------------- 设置 ---------------- */

export async function getSetting(key, fallback = null) {
  const db = await getDB()
  const row = await db.get('settings', key)
  return row ? row.value : fallback
}

export async function setSetting(key, value) {
  const db = await getDB()
  await db.put('settings', { key, value })
}

/* ---------------- 同步支撑 ---------------- */

// 待上传的行（含墓碑）
export async function getDirty(storeName) {
  const db = await getDB()
  const all = await db.getAll(storeName)
  return all.filter((r) => r.dirty)
}

// 上传成功后清除标记；期间如果本地又改过（updatedAt 变新）就保持 dirty
export async function clearDirty(storeName, rows) {
  const db = await getDB()
  const tx = db.transaction(storeName, 'readwrite')
  for (const { id, updatedAt } of rows) {
    const cur = await tx.store.get(id)
    if (cur && cur.updatedAt === updatedAt) await tx.store.put({ ...cur, dirty: 0 })
  }
  await tx.done
}

// 合并服务端来的行：后写优先。本地更新的话保留本地，并继续标记待上传
export async function mergeRemote(storeName, remoteRows) {
  const db = await getDB()
  const tx = db.transaction(storeName, 'readwrite')
  let applied = 0
  for (const remote of remoteRows) {
    const local = await tx.store.get(remote.id)
    if (local && local.updatedAt > remote.updatedAt) continue // 本地更新，等着被推上去
    await tx.store.put({ ...remote, dirty: 0 })
    applied++
  }
  await tx.done
  return applied
}

// 墓碑同步完成后就没用了，清掉省空间（留 30 天以防同步落后的设备）
export async function purgeTombstones(maxAgeMs = 30 * 24 * 3600 * 1000) {
  const db = await getDB()
  const cutoff = Date.now() - maxAgeMs
  for (const name of ['transactions', 'categories', 'accounts']) {
    const tx = db.transaction(name, 'readwrite')
    const all = await tx.store.getAll()
    for (const r of all) {
      if (r.deletedAt && !r.dirty && r.deletedAt < cutoff) await tx.store.delete(r.id)
    }
    await tx.done
  }
}

/* ---------------- 备份 / 恢复 ---------------- */

export async function exportAll() {
  const db = await getDB()
  const [transactions, categories, accounts, settings] = await Promise.all([
    db.getAll('transactions'),
    db.getAll('categories'),
    db.getAll('accounts'),
    db.getAll('settings'),
  ])
  return {
    format: 'transaction-record-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    transactions: transactions.filter(alive),
    categories: categories.filter(alive),
    accounts: accounts.filter(alive),
    settings: settings.filter((s) => !String(s.key).startsWith('sync.')),
  }
}

export async function importAll(data, mode = 'merge') {
  if (!data || data.format !== 'transaction-record-backup') {
    throw new Error('文件格式不正确，请选择本应用导出的备份文件')
  }
  const db = await getDB()
  const now = Date.now()
  const tx = db.transaction(['transactions', 'categories', 'accounts', 'settings'], 'readwrite')
  if (mode === 'replace') {
    await Promise.all([
      tx.objectStore('transactions').clear(),
      tx.objectStore('categories').clear(),
      tx.objectStore('accounts').clear(),
    ])
  }
  for (const a of data.accounts || []) {
    tx.objectStore('accounts').put({
      ...a,
      updatedAt: now,
      deletedAt: a.deletedAt ?? null,
      dirty: 1,
    })
  }
  for (const c of data.categories || []) {
    tx.objectStore('categories').put({
      ...c,
      updatedAt: now,
      deletedAt: c.deletedAt ?? null,
      dirty: 1,
    })
  }
  for (const t of data.transactions || []) {
    tx.objectStore('transactions').put({
      ...t,
      month: t.month || t.date.slice(0, 7),
      accountId: t.accountId ?? DEFAULT_ACCOUNTS[0].id,
      updatedAt: now,
      deletedAt: t.deletedAt ?? null,
      dirty: 1,
    })
  }
  for (const s of data.settings || []) tx.objectStore('settings').put(s)
  await tx.done
  return (data.transactions || []).length
}

/**
 * 清空全部数据。
 *
 * 注意这里是「立墓碑」而不是直接删行：如果直接删，下次同步会把云端的数据
 * 原样拉回来，用户会以为清空失败。立墓碑才能把删除这件事传播到其他设备。
 */
export async function clearAllData() {
  const db = await getDB()
  const now = Date.now()
  const tx = db.transaction(['transactions', 'categories', 'accounts'], 'readwrite')

  for (const name of ['transactions', 'categories', 'accounts']) {
    const store = tx.objectStore(name)
    const all = await store.getAll()
    for (const r of all) {
      if (!r.deletedAt) await store.put({ ...r, deletedAt: now, updatedAt: now, dirty: 1 })
    }
  }

  const accStore = tx.objectStore('accounts')
  for (const a of DEFAULT_ACCOUNTS) {
    await accStore.put({ ...a, createdAt: now + 1, updatedAt: now + 1, deletedAt: null, dirty: 1 })
  }

  // 默认分类用的是固定 id，用更新的时间戳写回去即可「复活」
  const catStore = tx.objectStore('categories')
  for (const c of DEFAULT_CATEGORIES) {
    await catStore.put({
      ...c,
      createdAt: now + 1,
      updatedAt: now + 1,
      deletedAt: null,
      dirty: 1,
    })
  }

  await tx.done
}

// 切换账号时：清空本地并重新从云端拉全量
export async function resetForNewAccount() {
  const db = await getDB()
  const tx = db.transaction(['transactions', 'categories', 'accounts'], 'readwrite')
  await Promise.all([
    tx.objectStore('transactions').clear(),
    tx.objectStore('categories').clear(),
    tx.objectStore('accounts').clear(),
  ])
  await tx.done
}
