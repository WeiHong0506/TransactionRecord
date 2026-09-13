import { openDB } from 'idb'
import { DEFAULT_CATEGORIES } from './categories.js'

const DB_NAME = 'transaction-record'
const DB_VERSION = 1

let dbPromise = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('transactions')) {
          const tx = db.createObjectStore('transactions', { keyPath: 'id' })
          tx.createIndex('by-date', 'date')
          tx.createIndex('by-month', 'month')
          tx.createIndex('by-category', 'categoryId')
        }
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' })
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

/* ---------------- 分类 ---------------- */

export async function initCategories() {
  const db = await getDB()
  const existing = await db.count('categories')
  if (existing > 0) return
  const tx = db.transaction('categories', 'readwrite')
  await Promise.all(DEFAULT_CATEGORIES.map((c) => tx.store.put(c)))
  await tx.done
}

export async function getCategories() {
  const db = await getDB()
  const all = await db.getAll('categories')
  return all.sort((a, b) => a.order - b.order)
}

export async function saveCategory(category) {
  const db = await getDB()
  await db.put('categories', category)
}

export async function deleteCategory(id) {
  const db = await getDB()
  // 该分类下已有记录时，记录保留，读取时回退为「未分类」
  await db.delete('categories', id)
}

/* ---------------- 流水 ---------------- */

// record: { id, type, amount, categoryId, note, date:'YYYY-MM-DD', month:'YYYY-MM', createdAt, updatedAt }
export async function saveTransaction(record) {
  const db = await getDB()
  const now = Date.now()
  const full = {
    ...record,
    id: record.id || newId(),
    month: record.date.slice(0, 7),
    amount: Math.round(Number(record.amount) * 100) / 100,
    createdAt: record.createdAt ?? now,
    updatedAt: now,
  }
  await db.put('transactions', full)
  return full
}

export async function deleteTransaction(id) {
  const db = await getDB()
  await db.delete('transactions', id)
}

export async function getAllTransactions() {
  const db = await getDB()
  const all = await db.getAll('transactions')
  return sortRecords(all)
}

export async function getTransactionsByMonth(month) {
  const db = await getDB()
  const all = await db.getAllFromIndex('transactions', 'by-month', month)
  return sortRecords(all)
}

export async function getMonthsWithData() {
  const db = await getDB()
  const all = await db.getAll('transactions')
  return [...new Set(all.map((t) => t.month))].sort().reverse()
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

/* ---------------- 备份 / 恢复 ---------------- */

export async function exportAll() {
  const db = await getDB()
  const [transactions, categories, settings] = await Promise.all([
    db.getAll('transactions'),
    db.getAll('categories'),
    db.getAll('settings'),
  ])
  return {
    format: 'transaction-record-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions,
    categories,
    settings,
  }
}

// mode: 'merge' 合并（同 id 覆盖） | 'replace' 先清空再导入
export async function importAll(data, mode = 'merge') {
  if (!data || data.format !== 'transaction-record-backup') {
    throw new Error('文件格式不正确，请选择本应用导出的备份文件')
  }
  const db = await getDB()
  const tx = db.transaction(['transactions', 'categories', 'settings'], 'readwrite')
  if (mode === 'replace') {
    await Promise.all([
      tx.objectStore('transactions').clear(),
      tx.objectStore('categories').clear(),
    ])
  }
  for (const c of data.categories || []) tx.objectStore('categories').put(c)
  for (const t of data.transactions || []) {
    tx.objectStore('transactions').put({ ...t, month: t.month || t.date.slice(0, 7) })
  }
  for (const s of data.settings || []) tx.objectStore('settings').put(s)
  await tx.done
  return (data.transactions || []).length
}

export async function clearAllData() {
  const db = await getDB()
  const tx = db.transaction(['transactions', 'categories', 'settings'], 'readwrite')
  await Promise.all([
    tx.objectStore('transactions').clear(),
    tx.objectStore('categories').clear(),
    tx.objectStore('settings').clear(),
  ])
  await tx.done
  await initCategories()
}
