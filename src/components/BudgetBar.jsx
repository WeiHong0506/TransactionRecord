import { formatAmount, symbolOf } from '../utils.js'

/**
 * 预算进度条。
 *
 * 状态同时用颜色和文字表达，不只靠颜色——色觉障碍的人看不出红绿差别，
 * 但「超支 RM 120」这几个字谁都读得懂。
 *
 * 超支时进度条满格并变红，而不是画一根冲出容器的条：
 * 越界的量用数字讲，条本身只负责「满了没有」。
 */
export default function BudgetBar({ line, currency, compact = false }) {
  if (!line) return null

  // limit 为 null = 这条预算是用某个没设汇率的货币定的，算不出来
  if (line.limit === null) {
    return (
      <div className="bud-row">
        <div className="bud-head">
          <span className="bud-name">{compact ? line.name : '本月预算'}</span>
          <span className="bud-note">预算货币未设汇率</span>
        </div>
      </div>
    )
  }

  const sym = symbolOf(currency)
  const pct = Math.min(1, Math.max(0, line.pct ?? 0))
  const over = line.state === 'over'

  return (
    <div className="bud-row" data-state={line.state}>
      <div className="bud-head">
        <span className="bud-name">
          {compact && line.icon ? <span className="e">{line.icon}</span> : null}
          {compact ? line.name : '本月预算'}
        </span>
        <span className="bud-num">
          {formatAmount(line.used)}
          <span className="sep"> / </span>
          <span className="lim">
            {sym} {formatAmount(line.limit)}
          </span>
        </span>
      </div>

      <div
        className="bud-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((line.pct ?? 0) * 100)}
        aria-label={`${compact ? line.name : '本月预算'}已用 ${Math.round((line.pct ?? 0) * 100)}%`}
      >
        <span className="bud-fill" style={{ width: `${pct * 100}%` }} />
      </div>

      <div className="bud-foot">
        <span className={over ? 'over' : ''}>
          {over ? `超支 ${sym} ${formatAmount(-line.left)}` : `还剩 ${sym} ${formatAmount(line.left)}`}
        </span>
        {!compact && !over && line.perDay > 0 && (
          <span className="per-day">
            日均可花 {sym} {formatAmount(line.perDay)}
          </span>
        )}
      </div>
    </div>
  )
}
