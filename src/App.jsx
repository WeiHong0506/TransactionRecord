import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteCategory,
  deleteTransaction,
  getAllTransactions,
  getCategories,
  getSetting,
  initCategories,
  saveCategory,
  saveTransaction,
  setSetting,
} from './db.js'
import { currentMonth, formatAmount, monthLabel, shiftMonth, symbolOf, sumBy } from './utils.js'
import TransactionList from './components/TransactionList.jsx'
import TransactionSheet from './components/TransactionSheet.jsx'
import CategoryManager from './components/CategoryManager.jsx'
import Stats from './components/Stats.jsx'
import Settings from './components/Settings.jsx'
import { useSync } from './useSync.js'

export default function App() {
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState('list')
  const [month, setMonth] = useState(currentMonth())
  const [records, setRecords] = useState([])
  const [categories, setCategories] = useState([])
  const [currency, setCurrency] = useState('MYR')
  const [theme, setTheme] = useState('system')
  const [editing, setEditing] = useState(null) // null | {} | record
  const [showCategories, setShowCategories] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const [lastBackup, setLastBackup] = useState(null)

  const reload = useCallback(async () => {
    const [rs, cs] = await Promise.all([getAllTransactions(), getCategories()])
    setRecords(rs)
    setCategories(cs)
  }, [])

  // 云端同步：未配置 Supabase 参数时整套逻辑静默关闭
  const sync = useSync(reload)

  useEffect(() => {
    ;(async () => {
      await initCategories()
      const [cur, th] = await Promise.all([
        getSetting('currency', 'MYR'),
        getSetting('theme', 'system'),
      ])
      setCurrency(cur)
      setTheme(th)
      setLastBackup(localStorage.getItem('lastBackup'))
      await reload()
      setReady(true)
    })()
  }, [reload])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2400)
  }, [])

  const monthRecords = useMemo(
    () => records.filter((t) => t.month === month),
    [records, month]
  )
  const expense = sumBy(monthRecords, 'expense')
  const income = sumBy(monthRecords, 'income')
  const balance = income - expense

  const isCurrentMonth = month === currentMonth()

  async function handleSave(record) {
    await saveTransaction(record)
    setEditing(null)
    setMonth(record.date.slice(0, 7))
    await reload()
    toast(record.id ? '已保存' : '已记一笔')
    sync.scheduleSync()
  }

  async function handleDelete(id) {
    await deleteTransaction(id)
    setEditing(null)
    await reload()
    toast('已删除')
    sync.scheduleSync()
  }

  if (!ready) {
    return (
      <div className="app">
        <div className="empty" style={{ paddingTop: 120 }}>
          <div className="big">💰</div>
          <p>正在打开…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="month-switch">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月">
            ‹
          </button>
          <span className="label">{monthLabel(month)}</span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={isCurrentMonth}
            aria-label="下个月"
          >
            ›
          </button>
        </div>
        {!isCurrentMonth && (
          <button className="icon-btn" onClick={() => setMonth(currentMonth())} aria-label="回到本月">
            ⟲
          </button>
        )}
      </header>

      <section className="summary">
        <div className="label">{monthLabel(month)}结余</div>
        <div className="hero">
          <span className="sym">{symbolOf(currency)}</span>
          {balance < 0 && '-'}
          {formatAmount(balance)}
        </div>
        <div className="split">
          <div className="stat">
            <div className="k">
              <i className="dot expense" />
              支出
            </div>
            <div className="v">{formatAmount(expense)}</div>
          </div>
          <div className="stat">
            <div className="k">
              <i className="dot income" />
              收入
            </div>
            <div className="v">{formatAmount(income)}</div>
          </div>
        </div>
      </section>

      <main>
        {tab === 'list' && (
          <div className="section">
            <div className="section-head">
              <h2>收支明细</h2>
              <span className="hint">{monthRecords.length} 笔</span>
            </div>
            <TransactionList
              records={monthRecords}
              categories={categories}
              onEdit={(t) => setEditing(t)}
            />
          </div>
        )}

        {tab === 'stats' && (
          <Stats
            month={month}
            monthRecords={monthRecords}
            allRecords={records}
            categories={categories}
            currency={currency}
            onEdit={(t) => setEditing(t)}
          />
        )}

        {tab === 'settings' && (
          <Settings
            currency={currency}
            onCurrencyChange={async (c) => {
              setCurrency(c)
              await setSetting('currency', c)
            }}
            theme={theme}
            onThemeChange={async (t) => {
              setTheme(t)
              await setSetting('theme', t)
            }}
            lastBackup={lastBackup}
            onOpenCategories={() => setShowCategories(true)}
            onReload={async () => {
              setLastBackup(localStorage.getItem('lastBackup'))
              await reload()
            }}
            toast={toast}
            records={records}
            categories={categories}
            sync={sync}
          />
        )}
      </main>

      <nav className="tabbar">
        <div className="tabbar-inner">
          <button
            className={`tab ${tab === 'list' ? 'active' : ''}`}
            onClick={() => setTab('list')}
          >
            <span className="ico">📋</span>
            明细
          </button>
          <button
            className={`tab ${tab === 'stats' ? 'active' : ''}`}
            onClick={() => setTab('stats')}
          >
            <span className="ico">📊</span>
            统计
          </button>
          <button className="fab" onClick={() => setEditing({})} aria-label="记一笔">
            ＋
          </button>
          <button
            className={`tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            <span className="ico">⚙️</span>
            设置
          </button>
          <div className="tab" aria-hidden style={{ visibility: 'hidden' }}>
            <span className="ico">·</span>
            占位
          </div>
        </div>
      </nav>

      {editing && (
        <TransactionSheet
          categories={categories}
          currency={currency}
          initial={editing.id ? editing : null}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
        />
      )}

      {showCategories && (
        <CategoryManager
          categories={categories}
          onSave={async (c) => {
            await saveCategory(c)
            await reload()
            sync.scheduleSync()
          }}
          onDelete={async (id) => {
            await deleteCategory(id)
            await reload()
            sync.scheduleSync()
          }}
          onClose={() => setShowCategories(false)}
        />
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  )
}
