import { formatAmount, monthLabel, symbolOf } from '../utils.js'

/**
 * 和上月对比。
 *
 * 「本月餐饮 920」是个孤立的数字，说明不了任何事；
 * 「比上月多花了 320，涨了一半」立刻就有含义，而且指向一个可以做的决定。
 *
 * 只列变化最大的那几项，不是全部——全列出来等于没列，
 * 眼睛会滑过去，那几条真正值得看的就被淹了。
 */
export default function CompareSection({ compare, currency, month, limit = 5 }) {
  if (!compare) return null
  const sym = symbolOf(currency)

  if (!compare.comparable) {
    return (
      <div className="section">
        <div className="section-head">
          <h2>和上月对比</h2>
        </div>
        <div className="card card-pad empty">
          <div className="big">📆</div>
          <p>{monthLabel(compare.prevMonth)}没有支出记录</p>
          <p>连着记两个月，这里就能看出变化</p>
        </div>
      </div>
    )
  }

  const up = compare.totalDelta > 0
  // 变化小于 1 块的当作没变——四舍五入的零头不值得占一行
  const rows = compare.rows.filter((r) => Math.abs(r.delta) >= 1).slice(0, limit)

  return (
    <div className="section">
      <div className="section-head">
        <h2>和上月对比</h2>
        <span className="hint">{monthLabel(compare.prevMonth)}</span>
      </div>

      <div className="card card-pad">
        <div className="cmp-hero" data-dir={up ? 'up' : 'down'}>
          <span className="cmp-hero-v">
            {up ? '+' : '−'} {sym} {formatAmount(compare.totalDelta)}
          </span>
          <span className="cmp-hero-k">
            总支出比上月{up ? '多' : '少'}
            {compare.totalPct !== null && ` ${Math.abs(compare.totalPct * 100).toFixed(0)}%`}
            {` · ${formatAmount(compare.totalBefore)} → ${formatAmount(compare.totalNow)}`}
          </span>
        </div>

        {rows.length > 0 ? (
          <div className="cmp-rows">
            {rows.map((r) => (
              <CompareRow key={r.id} row={r} sym={sym} />
            ))}
          </div>
        ) : (
          <p className="cmp-none">各个分类都和上月差不多，没有明显变化。</p>
        )}
      </div>
    </div>
  )
}

function CompareRow({ row, sym }) {
  const up = row.delta > 0
  // 条形的长度只表达「相对其他行变化多大」，所以按本行绝对值归一没意义——
  // 这里用的是行内最大值，由父级保证 rows 已按绝对值降序，第一行就是最大的
  return (
    <div className="cmp-row" data-dir={up ? 'up' : 'down'}>
      <span className="cmp-name">
        <span className="e">{row.icon}</span>
        {row.name}
      </span>
      <span className="cmp-nums">
        <span className="cmp-delta">
          {up ? '+' : '−'} {sym} {formatAmount(row.delta)}
        </span>
        <span className="cmp-sub">
          {/* 文字把状态说清楚，不让颜色单独扛 */}
          {row.isNew
            ? '上月没有'
            : row.isGone
              ? '本月没有'
              : `${formatAmount(row.before)} → ${formatAmount(row.now)}${
                  row.pct !== null ? ` · ${up ? '↑' : '↓'}${Math.abs(row.pct * 100).toFixed(0)}%` : ''
                }`}
        </span>
      </span>
    </div>
  )
}
