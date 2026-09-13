import { useState } from 'react'
import { formatAmount, formatMoney, symbolOf } from '../utils.js'

const SIZE = 190
const R_OUT = 88
const R_IN = 56
const GAP = 2 // 相邻扇区之间留 2px 表面色缝隙

function polar(cx, cy, r, angle) {
  const a = ((angle - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arcPath(cx, cy, rOut, rIn, start, end) {
  const large = end - start > 180 ? 1 : 0
  const [x1, y1] = polar(cx, cy, rOut, start)
  const [x2, y2] = polar(cx, cy, rOut, end)
  const [x3, y3] = polar(cx, cy, rIn, end)
  const [x4, y4] = polar(cx, cy, rIn, start)
  return [
    `M ${x1} ${y1}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

/**
 * 颜色说明：每个分类的颜色跟着分类本身走（存在 category.slot 里），
 * 切换月份不会让同一个分类换色。超过 7 个分类时尾部会合并成「其他分类」，
 * 避免颜色被迫循环使用。同屏 4 个以上的色相无法做到两两都可区分，
 * 因此识别不依赖颜色：下方图例带图标、名称、金额，另有数据表可展开。
 */
export default function DonutChart({ rows, total, currency, centerLabel = '合计' }) {
  const [hover, setHover] = useState(null)
  const cx = SIZE / 2
  const cy = SIZE / 2

  if (!rows.length || total <= 0) return null

  // 缝隙用角度表示，保证小扇区也不会被吃掉
  const gapDeg = (GAP / (2 * Math.PI * R_OUT)) * 360
  let cursor = 0
  const slices = rows.map((r) => {
    const sweep = (r.value / total) * 360
    const start = cursor
    const end = cursor + sweep
    cursor = end
    const s = rows.length > 1 ? start + gapDeg / 2 : start
    const e = rows.length > 1 ? Math.max(end - gapDeg / 2, s + 0.4) : end
    return { ...r, start: s, end: e, mid: (start + end) / 2, pct: (r.value / total) * 100 }
  })

  const active = hover != null ? slices[hover] : null

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="按分类的占比环形图">
        {slices.map((s, i) => (
          <path
            key={s.id}
            d={arcPath(cx, cy, R_OUT, R_IN, s.start, s.end)}
            fill={`var(--series-${s.slot})`}
            opacity={hover != null && hover !== i ? 0.35 : 1}
            style={{ transition: 'opacity .15s' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onTouchStart={() => setHover(i)}
          />
        ))}
        <g className="donut-center" textAnchor="middle">
          <text className="k" x={cx} y={cy - 6}>
            {active ? active.name : `${centerLabel}（${symbolOf(currency)}）`}
          </text>
          <text className="v" x={cx} y={cy + 13}>
            {active ? `${active.pct.toFixed(1)}%` : formatAmount(total)}
          </text>
        </g>
      </svg>

      {active && (
        <div
          className="tooltip"
          style={{
            left: `${(polar(cx, cy, (R_OUT + R_IN) / 2, active.mid)[0] / SIZE) * 100}%`,
            top: `${(polar(cx, cy, (R_OUT + R_IN) / 2, active.mid)[1] / SIZE) * 100}%`,
          }}
        >
          <div className="t-k">
            {active.icon} {active.name}
          </div>
          <div className="t-v">
            {formatMoney(active.value, currency)} · {active.pct.toFixed(1)}%
          </div>
        </div>
      )}

      {/* 图例同时是直接标注：名称与金额都是文字，识别不依赖颜色 */}
      <div className="legend">
        {slices.map((s, i) => (
          <button
            key={s.id}
            className="legend-row"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <span className="sw" style={{ background: `var(--series-${s.slot})` }} />
            <span className="nm">
              {s.icon} {s.name}
            </span>
            <span className="pct">{s.pct.toFixed(0)}%</span>
            <span className="val">{formatAmount(s.value)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
