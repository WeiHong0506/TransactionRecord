import { useMemo, useState } from 'react'
import TransactionList from './TransactionList.jsx'
import { dateHeading, formatMoney, monthLabel, sumBy, todayStr } from '../utils.js'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// 格子只有几十像素宽，金额必须压缩，否则会把布局撑坏。
// 一眼扫过去看的是量级，所以统一取整；只有小于 10 时才保留一位小数。
function compact(v) {
  if (v >= 10000) return Math.round(v / 1000) + 'k'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
  if (v >= 10) return String(Math.round(v))
  return v.toFixed(1).replace(/\.0$/, '')
}

export default function CalendarView({ month, records, categories, accounts, currency, onEdit }) {
  const [selected, setSelected] = useState(null)

  const { cells, byDate } = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const first = new Date(y, m - 1, 1)
    const total = new Date(y, m, 0).getDate()

    const map = new Map()
    for (const t of records) {
      if (!map.has(t.date)) map.set(t.date, { expense: 0, income: 0 })
      const e = map.get(t.date)
      if (t.type === 'expense') e.expense += Number(t.amount)
      else e.income += Number(t.amount)
    }

    const out = []
    for (let i = 0; i < first.getDay(); i++) out.push(null) // 月初的空格
    for (let d = 1; d <= total; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      out.push({ day: d, date, ...(map.get(date) ?? { expense: 0, income: 0 }) })
    }
    return { cells: out, byDate: map }
  }, [month, records])

  const today = todayStr()
  const selectedRecords = selected ? records.filter((t) => t.date === selected) : []

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2>{monthLabel(month)}日历</h2>
          <span className="hint">{byDate.size} 天有记录</span>
        </div>

        <div className="card card-pad">
          <div className="cal-week">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={i === 0 || i === 6 ? 'we' : ''}>
                {w}
              </div>
            ))}
          </div>

          <div className="cal-grid">
            {cells.map((c, i) =>
              c === null ? (
                <div key={`b${i}`} className="cal-cell empty" />
              ) : (
                <button
                  key={c.date}
                  className={[
                    'cal-cell',
                    c.date === today ? 'today' : '',
                    c.date === selected ? 'selected' : '',
                    c.expense || c.income ? 'has-data' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelected(c.date === selected ? null : c.date)}
                  aria-label={`${c.day} 日`}
                  aria-pressed={c.date === selected}
                >
                  <span className="d">{c.day}</span>
                  <span className="amts">
                    {c.expense > 0 && <span className="e">-{compact(c.expense)}</span>}
                    {c.income > 0 && <span className="i">+{compact(c.income)}</span>}
                  </span>
                </button>
              )
            )}
          </div>

          <p className="cal-hint">点某一天查看当天明细</p>
        </div>
      </div>

      {selected && (
        <div className="section">
          <div className="section-head">
            <h2>{dateHeading(selected)}</h2>
            <span className="hint">
              {selectedRecords.length
                ? [
                    sumBy(selectedRecords, 'expense') > 0 &&
                      `支出 ${formatMoney(sumBy(selectedRecords, 'expense'), currency)}`,
                    sumBy(selectedRecords, 'income') > 0 &&
                      `收入 ${formatMoney(sumBy(selectedRecords, 'income'), currency)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '这天没有记录'}
            </span>
          </div>
          {selectedRecords.length > 0 && (
            <TransactionList
              records={selectedRecords}
              categories={categories}
              accounts={accounts}
              onEdit={onEdit}
              showDate={false}
            />
          )}
        </div>
      )}
    </div>
  )
}
