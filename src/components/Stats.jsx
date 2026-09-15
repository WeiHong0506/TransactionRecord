import { useMemo, useState } from 'react'
import DonutChart from './DonutChart.jsx'
import TrendChart from './TrendChart.jsx'
import CalendarView from './CalendarView.jsx'
import TransactionList from './TransactionList.jsx'
import ListFilter, { EMPTY_FILTER, applyFilter, isFiltered } from './ListFilter.jsx'
import BudgetBar from './BudgetBar.jsx'
import {
  formatAmount,
  homeAmountOf,
  formatMoney,
  groupByCategory,
  monthLabel,
  recentMonths,
  sumBy,
} from '../utils.js'

export default function Stats({
  month,
  monthRecords,
  allRecords,
  categories,
  accounts,
  currency,
  missingRates = [],
  budget,
  onOpenBudget,
  onOpenSettings,
  onEdit,
}) {
  const [view, setView] = useState('list') // list | calendar | breakdown
  const [type, setType] = useState('expense')
  const [filter, setFilter] = useState(EMPTY_FILTER)

  const filtered = useMemo(() => applyFilter(monthRecords, filter), [monthRecords, filter])

  const rows = useMemo(
    () => groupByCategory(monthRecords, categories, type),
    [monthRecords, categories, type]
  )
  const total = useMemo(() => sumBy(monthRecords, type), [monthRecords, type])

  const trend = useMemo(() => {
    const months = recentMonths(month, 6)
    return months.map((m) => {
      const inMonth = allRecords.filter((t) => t.month === m)
      return { month: m, expense: sumBy(inMonth, 'expense'), income: sumBy(inMonth, 'income') }
    })
  }, [allRecords, month])

  const dayCount = new Set(monthRecords.filter((t) => t.type === 'expense').map((t) => t.date)).size
  const expenseTotal = sumBy(monthRecords, 'expense')
  const avg = dayCount ? expenseTotal / dayCount : 0

  const rateWarning = missingRates.length > 0 && (
    <button className="note-box warn" onClick={onOpenSettings}>
      有 {missingRates.join('、')} 的记录还没设汇率，暂时不计入统计。点这里去设置 ›
    </button>
  )

  if (view === 'list') {
    return (
      <div>
        <ViewTabs view={view} setView={setView} />
        {rateWarning}
        <div className="section">
          <div className="section-head">
            <h2>收支明细</h2>
            <span className="hint">{monthRecords.length} 笔</span>
          </div>
          <ListFilter
            filter={filter}
            setFilter={setFilter}
            categories={categories}
            accounts={accounts}
            results={filtered}
          />
          {filtered.length === 0 && isFiltered(filter) ? (
            <div className="card empty">
              <div className="big">🔍</div>
              <p>没有符合条件的记录</p>
              <p>换个筛选条件试试</p>
            </div>
          ) : (
            <TransactionList
              records={filtered}
              categories={categories}
              accounts={accounts}
              currency={currency}
              onEdit={onEdit}
            />
          )}
        </div>
      </div>
    )
  }

  if (view === 'calendar') {
    return (
      <div>
        <ViewTabs view={view} setView={setView} />
        {rateWarning}
        <CalendarView
          month={month}
          records={monthRecords}
          categories={categories}
          accounts={accounts}
          currency={currency}
          onEdit={onEdit}
        />
      </div>
    )
  }

  return (
    <div>
      <ViewTabs view={view} setView={setView} />
      {rateWarning}

      <div className="section">
        <div className="section-head">
          <h2>{monthLabel(month)}分类构成</h2>
        </div>
        <div className="card card-pad">
          <div className="seg" role="group" aria-label="统计类型">
            <button aria-pressed={type === 'expense'} onClick={() => setType('expense')}>
              支出
            </button>
            <button aria-pressed={type === 'income'} onClick={() => setType('income')}>
              收入
            </button>
          </div>

          {total > 0 ? (
            <>
              <DonutChart
                rows={rows}
                total={total}
                currency={currency}
                centerLabel={type === 'expense' ? '本月支出' : '本月收入'}
              />
              <details className="table-toggle">
                <summary>查看数据表</summary>
                <table className="table-view">
                  <thead>
                    <tr>
                      <th>分类</th>
                      <th className="num">金额</th>
                      <th className="num">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.icon} {r.name}
                        </td>
                        <td className="num">{formatAmount(r.value)}</td>
                        <td className="num">{((r.value / total) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <div className="empty">
              <div className="big">📊</div>
              <p>本月还没有{type === 'expense' ? '支出' : '收入'}记录</p>
            </div>
          )}
        </div>
      </div>

      {type === 'expense' && (
        <div className="section">
          <div className="section-head">
            <h2>分类预算</h2>
            <button className="link-btn" onClick={onOpenBudget}>
              {budget?.perCategory?.length ? '调整' : '去设置'}
            </button>
          </div>
          {budget?.perCategory?.length ? (
            <div className="card card-pad bud-list">
              {budget.perCategory.map((line) => (
                <BudgetBar key={line.id} line={line} currency={currency} compact />
              ))}
            </div>
          ) : (
            <button className="card card-pad empty bud-empty" onClick={onOpenBudget}>
              <div className="big">🎯</div>
              <p>还没给任何分类设上限</p>
              <p>设一个，这里就会显示进度</p>
            </button>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h2>近 6 个月收支</h2>
        </div>
        <div className="card card-pad">
          <TrendChart data={trend} currency={currency} />
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>本月小结</h2>
        </div>
        <div className="card card-pad">
          <div className="summary-grid" style={{ display: 'grid', gap: 14 }}>
            <Line k="有支出的天数" v={`${dayCount} 天`} />
            <Line k="日均支出（按有记录的天）" v={formatMoney(avg, currency)} />
            <Line k="本月记录笔数" v={`${monthRecords.length} 笔`} />
            <Line
              k="最大单笔支出"
              v={
                monthRecords.some((t) => t.type === 'expense')
                  ? formatMoney(
                      Math.max(
                        ...monthRecords
                          .filter((t) => t.type === 'expense' && homeAmountOf(t) !== null)
                          .map((t) => homeAmountOf(t))
                      ),
                      currency
                    )
                  : '—'
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function ViewTabs({ view, setView }) {
  return (
    <div className="seg view-tabs" role="group" aria-label="统计视图">
      <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
        明细
      </button>
      <button aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>
        日历
      </button>
      <button aria-pressed={view === 'breakdown'} onClick={() => setView('breakdown')}>
        分类构成
      </button>
    </div>
  )
}

function Line({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{k}</span>
      <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  )
}
