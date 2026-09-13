import { dateHeading, formatAmount, groupByDate, sumBy } from '../utils.js'

// showDate=false 用于日历视图：那里的日期和合计已经由外层标题给出了
export default function TransactionList({ records, categories, onEdit, showDate = true }) {
  if (!records.length) {
    return (
      <div className="card empty">
        <div className="big">🧾</div>
        <p>这个月还没有记录</p>
        <p>点下面的 + 记第一笔</p>
      </div>
    )
  }

  const byId = new Map(categories.map((c) => [c.id, c]))
  const days = groupByDate(records)

  return (
    <div>
      {days.map(([date, items]) => {
        const exp = sumBy(items, 'expense')
        const inc = sumBy(items, 'income')
        return (
          <div className="day-group" key={date}>
            {showDate && (
              <div className="day-head">
                <span>{dateHeading(date)}</span>
                <span className="sums">
                  {exp > 0 && <>支出 {formatAmount(exp)}</>}
                  {exp > 0 && inc > 0 && ' · '}
                  {inc > 0 && <>收入 {formatAmount(inc)}</>}
                </span>
              </div>
            )}
            <div className="card">
              {items.map((t) => {
                const cat = byId.get(t.categoryId)
                return (
                  <button className="row" key={t.id} onClick={() => onEdit(t)}>
                    <span className="emoji">{cat?.icon ?? '❔'}</span>
                    <span className="body">
                      <span className="name">{cat?.name ?? '未分类'}</span>
                      {t.note && <span className="note">{t.note}</span>}
                    </span>
                    <span className={`amt ${t.type}`}>
                      {t.type === 'expense' ? '-' : '+'}
                      {formatAmount(t.amount)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
