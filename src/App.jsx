import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteAccount,
  deleteCategory,
  deleteTransaction,
  getAccounts,
  getAllTransactions,
  getBudgets,
  getCategories,
  getSetting,
  initAccounts,
  initCategories,
  saveAccount,
  saveBudget,
  saveCategory,
  saveTransaction,
  setSetting,
} from './db.js'
import {
  DEFAULT_FX,
  currentMonth,
  formatAmount,
  monthLabel,
  rateOf,
  renormalizeFx,
  shiftMonth,
  symbolOf,
  sumBy,
  todayStr,
} from './utils.js'
import TransactionPage from './components/TransactionPage.jsx'
import CategoryManager from './components/CategoryManager.jsx'
import Stats from './components/Stats.jsx'
import Settings from './components/Settings.jsx'
import AccountsPage from './components/AccountsPage.jsx'
import ImportSheet from './components/ImportSheet.jsx'
import TabBar from './components/TabBar.jsx'
import BudgetSettings from './components/BudgetSettings.jsx'
import BudgetBar from './components/BudgetBar.jsx'
import { computeBudget } from './budget.js'
import { useSync } from './useSync.js'

export default function App() {
  const [ready, setReady] = useState(false)
  // stats | accounts | settings | budget（后两个不在底部导航里，从资产页右上角进）
  const [tab, setTab] = useState('stats')
  const [month, setMonth] = useState(currentMonth())
  const [records, setRecords] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [budgets, setBudgets] = useState([])
  // currency 现在的含义是「主货币」：所有折算后的数字都用它表示
  const [currency, setCurrency] = useState('MYR')
  const [fx, setFx] = useState(DEFAULT_FX)
  // 税率是配置（记住），开关是这一笔的选择（每次归零）
  const [taxRates, setTaxRates] = useState({ sc: 10, sst: 6 })
  const [theme, setTheme] = useState('system')
  const [editing, setEditing] = useState(null)
  const [showCategories, setShowCategories] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const [lastBackup, setLastBackup] = useState(null)
  const [lastAccountId, setLastAccountId] = useState(null)

  const reload = useCallback(async () => {
    const [rs, cs, as, bs] = await Promise.all([
      getAllTransactions(),
      getCategories(),
      getAccounts(),
      getBudgets(),
    ])
    setRecords(rs)
    setCategories(cs)
    setAccounts(as)
    setBudgets(bs)
  }, [])

  const sync = useSync(reload)

  useEffect(() => {
    ;(async () => {
      await initCategories()
      await initAccounts()
      const [cur, th, lastAcc, rates, tax] = await Promise.all([
        getSetting('currency', 'MYR'),
        getSetting('theme', 'system'),
        getSetting('lastAccountId', null),
        getSetting('fx', null),
        getSetting('taxRates', null),
      ])
      if (tax) setTaxRates(tax)
      setCurrency(cur)
      setFx(rates ?? { [cur]: 1 })
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

  /**
   * 折算只在这里做一次，给每条记录挂上 homeAmount，下游所有统计、图表、
   * 日历都只认它。好处是货币逻辑集中在一处，不用把汇率透传进每个组件，
   * 也不会出现某个图表忘了折算、悄悄把 ¥ 当 RM 加进去。
   *
   * homeAmount 为 null 表示这笔的货币还没设汇率——统计会跳过它，
   * 界面另有提示。宁可少算并说出来，也不要按 1:1 编一个看起来正常的数。
   */
  const priced = useMemo(() => {
    const accCur = new Map(accounts.map((a) => [a.id, a.currency || currency]))
    return records.map((t) => {
      const code = t.currency || accCur.get(t.accountId) || currency
      const r = rateOf(fx, code, currency)
      return { ...t, currency: code, homeAmount: r === null ? null : Number(t.amount) * r }
    })
  }, [records, accounts, fx, currency])

  // 有流水或有账户、但还没填汇率的货币。填了才算得出总资产和统计。
  const missingRates = useMemo(() => {
    const codes = new Set()
    for (const a of accounts) if (rateOf(fx, a.currency || currency, currency) === null) codes.add(a.currency)
    for (const t of priced) if (t.homeAmount === null) codes.add(t.currency)
    return [...codes].filter(Boolean)
  }, [accounts, priced, fx, currency])

  const monthRecords = useMemo(() => priced.filter((t) => t.month === month), [priced, month])

  const budget = useMemo(
    () =>
      computeBudget({
        records: monthRecords,
        budgets,
        categories,
        month,
        today: todayStr(),
        fx,
        home: currency,
      }),
    [monthRecords, budgets, categories, month, fx, currency]
  )
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
            {budget.total && (
              <div className="summary-budget">
                <BudgetBar line={budget.total} currency={currency} />
              </div>
            )}
          </section>

          <Stats
            month={month}
            monthRecords={monthRecords}
            allRecords={priced}
            categories={categories}
            accounts={accounts}
            currency={currency}
            missingRates={missingRates}
            budget={budget}
            onOpenBudget={() => setTab('budget')}
            onOpenSettings={() => setTab('settings')}
            onEdit={(t) => setEditing(t)}
          />
        </>
      )}

      {tab === 'accounts' && (
        <>
          <header className="topbar">
            <h1 className="page-title">资产</h1>
            <button className="icon-btn" onClick={() => setTab('settings')} aria-label="设置">
              ⚙️
            </button>
          </header>
          <AccountsPage
            accounts={accounts}
            records={priced}
            currency={currency}
            fx={fx}
            missingRates={missingRates}
            onOpenSettings={() => setTab('settings')}
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

      {tab === 'budget' && (
        <>
          <header className="topbar">
            <button className="icon-btn" onClick={() => setTab('settings')} aria-label="返回">
              ‹
            </button>
            <h1 className="page-title" style={{ flex: 1 }}>
              预算
            </h1>
            <span style={{ width: 36 }} />
          </header>
          <BudgetSettings
            budgets={budgets}
            categories={categories}
            currency={currency}
            onSave={async (id, amount) => {
              await saveBudget(id, amount, currency)
              await reload()
              sync.scheduleSync()
            }}
            onBack={() => setTab('settings')}
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
              // 换主货币时把汇率表按新主货币重新归一，
              // 否则旧汇率会被当成「兑新主货币」，所有折算数字一夜之间全错
              const next = renormalizeFx(fx, c)
              setCurrency(c)
              setFx(next)
              await setSetting('currency', c)
              await setSetting('fx', next)
            }}
            fx={fx}
            accounts={accounts}
            onFxChange={async (next) => {
              setFx(next)
              await setSetting('fx', next)
            }}
            theme={theme}
            onThemeChange={async (t) => {
              setTheme(t)
              await setSetting('theme', t)
            }}
            lastBackup={lastBackup}
            onOpenCategories={() => setShowCategories(true)}
            onOpenBudget={() => setTab('budget')}
            budgetCount={budgets.length}
            onOpenImport={() => setShowImport(true)}
            onReload={async () => {
              setLastBackup(localStorage.getItem('lastBackup'))
              await reload()
            }}
            toast={toast}
            records={priced}
            categories={categories}
            sync={sync}
          />
        </>
      )}

      <TabBar tab={tab} setTab={setTab} onAdd={() => setEditing({})} />

      {editing && (
        <TransactionPage
          categories={categories}
          accounts={accounts}
          currency={currency}
          initial={editing.id ? editing : null}
          defaultAccountId={lastAccountId}
          taxRates={taxRates}
          onTaxRatesChange={async (next) => {
            setTaxRates(next)
            await setSetting('taxRates', next)
          }}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
        />
      )}

      {showImport && (
        <ImportSheet
          accounts={accounts}
          categories={categories}
          currency={currency}
          defaultAccountId={lastAccountId}
          onParse={async (file, password) => {
            // 动态导入：pdf.js 只在真的要解析时才下载
            const [{ parseTngStatement, fingerprint }] = await Promise.all([
              import('./import/tngStatement.js'),
            ])
            const existing = new Set(
              records.map((t) => fingerprint(t.date, t.amount, t.note))
            )
            const learnedRules = (await getSetting('import.rules', {})) ?? {}
            return parseTngStatement(file, {
              existingFingerprints: existing,
              learnedRules,
              password,
            })
          }}
          onImport={async (rows, accountId) => {
            for (const r of rows) {
              await saveTransaction({
                type: r.direction,
                amount: r.amount,
                categoryId: r.categoryId,
                accountId,
                date: r.date,
                note: r.description || r.type,
              })
            }
            // 记住这次的分类判断，下个月导入时自动套用
            const learned = { ...((await getSetting('import.rules', {})) ?? {}) }
            for (const r of rows) {
              const kw = String(r.description || '')
                .split(/\s+/)
                .filter((w) => w.length >= 3)
                .slice(0, 2)
                .join(' ')
                .toLowerCase()
              if (kw && r.categoryId) learned[kw] = r.categoryId
            }
            await setSetting('import.rules', learned)

            setShowImport(false)
            await reload()
            toast(`已导入 ${rows.length} 笔`)
            sync.scheduleSync()
          }}
          onClose={() => setShowImport(false)}
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
