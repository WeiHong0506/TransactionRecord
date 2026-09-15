import { formatAmount, symbolOf } from '../utils.js'

// 「9月28日」比「09-28」好读，也不会被误认成某种编号
function dueLabel(due) {
  if (!due) return ''
  const [, m, d] = due.split('-')
  return `${Number(m)}月${Number(d)}日`
}

/**
 * 本月固定支出面板。
 *
 * 它不负责「别忘了取消订阅」，而是负责让预算说实话：
 * 月底还要扣 RM 1200 房租的话，「还剩 RM 470」就是个假数。
 *
 * 一笔一笔列出来，是为了让「点一下就记账」这件事成本足够低——
 * 自动记账会在某个月忘交或涨价时悄悄编造流水，那比不做更糟。
 */
export default function RecurringPanel({
  summary,
  categories = [],
  currency,
  onRecord,
  onOpenSettings,
  recordable = true,
}) {
  const items = summary?.thisMonth ?? []
  const byCat = new Map(categories.map((c) => [c.id, c]))
  const sym = symbolOf(currency)

  if (items.length === 0) {
    return (
      <div className="section">
        <div className="section-head">
          <h2>固定支出</h2>
          <button className="link-btn" onClick={onOpenSettings}>
            去设置
          </button>
        </div>
        <button className="card card-pad empty bud-empty" onClick={onOpenSettings}>
          <div className="big">📌</div>
          <p>还没登记房租、电话费这类每月必扣的钱</p>
          <p>登记之后，预算剩余才是真能自由花的数</p>
        </button>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-head">
        <h2>固定支出</h2>
        <button className="link-btn" onClick={onOpenSettings}>
          管理
        </button>
      </div>

      <div className="card rec-list">
        {items.map((i) => {
          const cat = byCat.get(i.categoryId)
          const state = i.paid ? 'paid' : i.overdue ? 'overdue' : 'due'
          return (
            <div className="rec-item" key={i.id} data-state={state}>
              <span className="rec-mark" aria-hidden="true">
                {i.paid ? '✓' : i.overdue ? '!' : '·'}
              </span>
              <span className="li-main">
                <span className="li-title">
                  <span className="e">{cat?.icon ?? '📌'}</span>
                  {i.name}
                </span>
                <span className="li-sub">
                  {dueLabel(i.due)}
                  {' · '}
                  {/* 状态同时用文字讲，不只靠颜色和符号 */}
                  {i.paid ? '已记账' : i.overdue ? '已过扣款日，还没记' : '待扣'}
                </span>
              </span>
              <span className="rec-right">
                <span className="rec-amt">
                  {symbolOf(i.currency || currency)} {formatAmount(i.paid ? (i.actual ?? i.amount) : i.amount)}
                </span>
                {!i.paid && recordable && (
                  <button className="rec-btn" onClick={() => onRecord(i)}>
                    记一笔
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      <div className="rec-foot">
        {summary.pending.length > 0 ? (
          <>
            本月还有 <strong>{summary.pending.length}</strong> 笔没记，合计{' '}
            <strong>
              {sym} {formatAmount(summary.pendingTotal)}
            </strong>
            {summary.unpriced > 0 && `（另有 ${summary.unpriced} 笔外币没设汇率，没算进去）`}
          </>
        ) : (
          <>本月 {summary.paidCount} 笔固定支出都记完了。</>
        )}
      </div>
    </div>
  )
}

/**
 * 可自由支配：预算剩余扣掉还没发生的固定支出。
 *
 * 这一行才是「今天到底还能花多少」的真答案。放在预算条正下方，
 * 因为预算条上那个「还剩」在房租没扣之前一直是虚高的。
 */
export function DiscretionaryLine({ value, pendingTotal, currency, days }) {
  if (value === null || value === undefined || !(pendingTotal > 0)) return null
  const sym = symbolOf(currency)
  const short = value < 0
  const perDay = days > 0 && value > 0 ? value / days : 0

  return (
    <div className="disc-line" data-state={short ? 'over' : 'ok'}>
      <span className="disc-k">
        预留 {sym} {formatAmount(pendingTotal)} 固定支出后
      </span>
      <span className="disc-v">
        {short ? (
          <>
            还差 {sym} {formatAmount(-value)}
          </>
        ) : (
          <>
            可自由支配 {sym} {formatAmount(value)}
            {perDay > 0 && <span className="per-day"> · 日均 {formatAmount(perDay)}</span>}
          </>
        )}
      </span>
    </div>
  )
}
