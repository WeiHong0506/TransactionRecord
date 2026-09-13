import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteAccount,
  deleteCategory,
  deleteTransaction,
  getAccounts,
  getAllTransactions,
  getCategories,
  getSetting,
  initAccounts,
  initCategories,
  saveAccount,
  saveCategory,
  saveTransaction,
  setSetting,
} from './db.js'
import { currentMonth, formatAmount, monthLabel, shiftMonth, symbolOf, sumBy } from './utils.js'
import TransactionSheet from './components/TransactionSheet.jsx'
import CategoryManager from './components/CategoryManager.jsx'
import Stats from './components/Stats.jsx'
import Settings from './components/Settings.jsx'
import AccountsPage from './components/AccountsPage.jsx'
import { useSync } from './useSync.js'

export default function App() {
  const [ready, setReady] = useState(false)
  // stats | accounts | settings（settings 不在底部导航里，从账号页右上角进）
  const [tab, setTab] = useState('stats')
  const [month, setMonth] = useState(currentMonth())
  const [records, setRecords] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [currency, setCurrency] = useState('MYR')
  const [theme, setTheme] = useState('system')
  const [editing, setEditing] = useState(null)
  const [showCategories, setShowCategories] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const [lastBackup, setLastBackup] = useState(null)
  const [lastAccountId, setLastAccountId] = useState(null)

  const reload = useCallback(async () => {
    const [rs, cs, as] = await Promise.all([getAllTransactions(), getCategories(), getAccounts()])
    setRecords(rs)
    setCategories(cs)
    setAccounts(as)
  }, [])

  const sync = useSync(reload)

  useEffect(() => {
    ;(async () => {
      await initCategories()
      await initAccounts()
      const [cur, th, lastAcc] = await Promise.all([
        getSetting('currency', 'MYR'),
        getSetting('theme', 'system'),
        getSetting('lastAccountId', null),
      ])
      setCurrency(cur)
      setTheme(th)
      setLastAccountId(lastAcc)
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

  const monthRecords = useMemo(() => records.filter((t) => t.month === month), [records, month])
  const expense = sumBy(monthRecords, 'expense')
  const income = sumBy(monthRecords, 'income')
  const balance = income - expense
  const isCurrentMonth = month === currentMonth()

  async function handleSave(record) {
    await saveTransaction(record)
    setEditing(null)
    setMonth(record.date.slice(0, 7))
    if (record.accountId) {
      setLastAccountId(record.accountId)
      await setSetting('lastAccountId', record.accountId)
    }
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
      {tab === 'stats' && (
        <>
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

          <Stats
            month={month}
            monthRecords={monthRecords}
            allRecords={records}
            categories={categories}
            accounts={accounts}
            currency={currency}
            onEdit={(t) => setEditing(t)}
          />
        </>
      )}

      {tab === 'accounts' && (
        <>
          <header className="topbar">
            <h1 className="page-title">账号管理</h1>
            <button className="icon-btn" onClick={() => setTab('settings')} aria-label="设置">
              ⚙️
            </button>
          </header>
          <AccountsPage
            accounts={accounts}
            records={records}
            currency={currency}
            onSave={async (a) => {
              await saveAccount(a)
              await reload()
              sync.scheduleSync()
              toast('已保存')
            }}
            onDelete={async (id) => {
              await deleteAccount(id)
              await reload()
              sync.scheduleSync()
              toast('账户已删除')
            }}
          />
        </>
      )}

      {tab === 'settings' && (
        <>
          <header className="topbar">
            <button className="icon-btn" onClick={() => setTab('accounts')} aria-label="返回">
              ‹
            </button>
            <h1 className="page-title" style={{ flex: 1 }}>
              设置
            </h1>
            <span style={{ width: 36 }} />
          </header>
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
        </>
      )}

      <nav className="tabbar">
        <div className="tabbar-inner">
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
            className={`tab ${tab === 'accounts' || tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('accounts')}
          >
            <span className="ico">👛</span>
            账号
          </button>
        </div>
      </nav>

      {editing && (
        <TransactionSheet
          categories={categories}
          accounts={accounts}
          currency={currency}
          initial={editing.id ? editing : null}
          defaultAccountId={lastAccountId}
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
