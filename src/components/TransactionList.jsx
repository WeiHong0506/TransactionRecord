import { dateHeading, formatAmount, groupByDate, sumBy, symbolOf } from '../utils.js'

// showDate=false 用于日历视图：那里的日期和合计已经由外层标题给出了
export default function TransactionList({
  records,
  categories,
  accounts = [],
  currency = 'MYR',
  onEdit,
  showDate = true,
}) {
  if (!records.length) {
    return (
      <div className="card empty">
        <div className="big">🧾</div>
        <p>这个月还没有记录</p>
        <p>点下面的 + 记第一笔</p>
      </div>
    )
  }

  const catById = new Map(categories.map((c) => [c.id, c]))
  const accById = new Map(accounts.map((a) => [a.id, a]))
  // 只有一个账户时，每行都标同一个账户名是纯噪音，还占掉备注的位置
  const showAccount = accounts.length > 1
  // 有外币记录时，日合计是折算后的主货币，得把符号标出来，
  // 否则「支出 245.00」会被误读成当天那笔 ¥245
  const mixed = records.some((t) => t.currency && t.currency !== currency)
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
                  {exp > 0 && (
                    <>
                      支出 {mixed && symbolOf(currency) + ' '}
                      {formatAmount(exp)}
                    </>
                  )}
                  {exp > 0 && inc > 0 && ' · '}
                  {inc > 0 && (
                    <>
                      收入 {mixed && symbolOf(currency) + ' '}
                      {formatAmount(inc)}
                    </>
                  )}
                </span>
              </div>
            )}
            <div className="card">
              {items.map((t) => {
                const cat = catById.get(t.categoryId)
                const acc = accById.get(t.accountId)
                // 账户和备注拼在副标题里；两个都没有时不占位
                const sub = [showAccount && acc && `${acc.icon} ${acc.name}`, t.note]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <button className="row" key={t.id} onClick={() => onEdit(t)}>
                    <span className="emoji">{cat?.icon ?? '❔'}</span>
                    <span className="body">
                      <span className="name">{cat?.name ?? '未分类'}</span>
                      {sub && <span className="note">{sub}</span>}
                    </span>
                    <span className={`amt ${t.type}`}>
                      {t.type === 'expense' ? '-' : '+'}
                      {/* 行内金额永远是当初真实付出去的那个数和那个币种，不折算 */}
                      {t.currency && t.currency !== currency && symbolOf(t.currency) + ' '}
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
