import { useState } from 'react'
import { formatMoney, shortMonthLabel } from '../utils.js'

const W = 320
const H = 168
const PAD = { top: 10, right: 4, bottom: 22, left: 34 }

// 顶端 4px 圆角、底端贴基线的柱形
function barPath(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h)
  if (h <= 0.5) return ''
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    'Z',
  ].join(' ')
}

function niceMax(v) {
  if (v <= 0) return 100
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * mag
}

function compact(v) {
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(Math.round(v))
}

export default function TrendChart({ data, currency }) {
  const [hover, setHover] = useState(null)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const max = niceMax(Math.max(...data.flatMap((d) => [d.expense, d.income]), 0))
  const ticks = [0, max / 2, max]

  const slotW = plotW / data.length
  const barW = Math.min(13, (slotW - 10) / 2)
  const y = (v) => PAD.top + plotH - (v / max) * plotH

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="近几个月收入与支出对比柱状图">
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="gridline"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              opacity={t === 0 ? 0 : 1}
            />
            <text className="tick" x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        <line
          className="baseline"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(0)}
          y2={y(0)}
        />

        {data.map((d, i) => {
          const cx = PAD.left + slotW * (i + 0.5)
          const xExp = cx - barW - 1 // 两根柱之间留 2px 表面色缝隙
          const xInc = cx + 1
          const dim = hover != null && hover !== i ? 0.35 : 1
          return (
            <g
              key={d.month}
              opacity={dim}
              style={{ transition: 'opacity .15s' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onTouchStart={() => setHover(i)}
            >
              {/* 透明热区，命中范围大于柱本身 */}
              <rect
                x={PAD.left + slotW * i}
                y={PAD.top}
                width={slotW}
                height={plotH}
                fill="transparent"
              />
              <path
                d={barPath(xExp, y(d.expense), barW, y(0) - y(d.expense))}
                fill="var(--expense)"
              />
              <path
                d={barPath(xInc, y(d.income), barW, y(0) - y(d.income))}
                fill="var(--income)"
              />
              <text className="tick" x={cx} y={H - 6} textAnchor="middle">
                {shortMonthLabel(d.month)}
              </text>
            </g>
          )
        })}
      </svg>

      {hover != null && (
        <div
          className="tooltip"
          style={{
            left: `${((PAD.left + slotW * (hover + 0.5)) / W) * 100}%`,
            top: `${(PAD.top / H) * 100}%`,
          }}
        >
          <div className="t-k">{data[hover].month}</div>
          <div className="t-v" style={{ color: 'var(--expense)' }}>
            支出 {formatMoney(data[hover].expense, currency)}
          </div>
          <div className="t-v" style={{ color: 'var(--income)' }}>
            收入 {formatMoney(data[hover].income, currency)}
          </div>
        </div>
      )}

      <div className="chart-legend-inline">
        <span>
          <i className="dot expense" /> 支出
        </span>
        <span>
          <i className="dot income" /> 收入
        </span>
      </div>
    </div>
  )
}
