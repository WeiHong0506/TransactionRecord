export const CURRENCIES = [
  { code: 'MYR', symbol: 'RM', label: '马来西亚令吉 (RM)' },
  { code: 'CNY', symbol: '¥', label: '人民币 (¥)' },
  { code: 'SGD', symbol: 'S$', label: '新加坡元 (S$)' },
  { code: 'USD', symbol: '$', label: '美元 ($)' },
  { code: 'TWD', symbol: 'NT$', label: '新台币 (NT$)' },
  { code: 'HKD', symbol: 'HK$', label: '港币 (HK$)' },
  { code: 'JPY', symbol: '¥', label: '日元 (¥)' },
  { code: 'EUR', symbol: '€', label: '欧元 (€)' },
  { code: 'GBP', symbol: '£', label: '英镑 (£)' },
]

export function symbolOf(code) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? 'RM'
}

const nf = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatAmount(value) {
  return nf.format(Math.abs(Number(value) || 0))
}

export function formatMoney(value, currency) {
  return `${symbolOf(currency)} ${formatAmount(value)}`
}

/* ---------------- 汇率 ---------------- */
/**
 * 汇率的含义全程统一为「1 单位该货币 = N 单位主货币」，主货币自己恒等于 1。
 * 这样折算永远是一次乘法，不用在代码里记方向，也不会出现除以零。
 *
 * 汇率是用户手填的估算值，不联网。它只影响「折算成主货币之后」的数字，
 * 每个账户自己的余额始终用它自己的货币算，永远和手机里的真实余额对得上。
 */
export const DEFAULT_FX = { MYR: 1 }

// 返回 null 表示这个货币还没设汇率——调用方要把它当作「算不出来」，
// 而不是偷偷按 1:1 处理，否则会凭空捏造一个看起来很正常的错数。
export function rateOf(fx, code, home) {
  if (!code || code === home) return 1
  const r = Number(fx?.[code])
  return Number.isFinite(r) && r > 0 ? r : null
}

export function toHome(amount, code, fx, home) {
  const r = rateOf(fx, code, home)
  return r === null ? null : Number(amount) * r
}

// 换主货币时把所有汇率按新主货币重新归一，货币之间的相对关系保持不变。
// 例如 1CNY=0.6MYR、主货币从 MYR 换成 CNY 之后，应该变成 1MYR≈1.667CNY。
export function renormalizeFx(fx, newHome) {
  const base = Number(fx?.[newHome])
  if (!Number.isFinite(base) || base <= 0) return { ...(fx ?? {}), [newHome]: 1 }
  const out = {}
  for (const [code, r] of Object.entries(fx ?? {})) {
    const v = Number(r)
    if (Number.isFinite(v) && v > 0) out[code] = v / base
  }
  out[newHome] = 1
  return out
}

/* ---------------- 日期 ---------------- */

// offsetDays 为负就是往前推，用 setDate 让跨月跨年自动正确
export function todayStr(offsetDays = 0) {
  const d = new Date()
  if (offsetDays) d.setDate(d.getDate() + offsetDays)
  return toDateStr(d)
}

export function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function currentMonth() {
  return todayStr().slice(0, 7)
}

export function monthLabel(month) {
  const [y, m] = month.split('-')
  return `${y} 年 ${Number(m)} 月`
}

export function shortMonthLabel(month) {
  return `${Number(month.split('-')[1])}月`
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function recentMonths(endMonth, count) {
  const out = []
  for (let i = count - 1; i >= 0; i--) out.push(shiftMonth(endMonth, -i))
  return out
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function dateHeading(dateStr) {
  const today = todayStr()
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const yesterday = toDateStr(new Date(Date.now() - 86400000))
  if (dateStr === today) return `今天 · ${m}月${d}日`
  if (dateStr === yesterday) return `昨天 · ${m}月${d}日`
  return `${m}月${d}日 · ${WEEKDAYS[date.getDay()]}`
}

/* ---------------- 汇总 ---------------- */

/**
 * 统计一律用折算成主货币后的 homeAmount，因为「RM 800 + ¥2400」这个和没有意义。
 * homeAmount 由 App 在加载时算好挂上去；为 null 表示该货币还没设汇率，
 * 这种记录直接跳过，界面上另有提示，而不是按原值混进来把总数搞错。
 */
export const homeAmountOf = (t) => (t.homeAmount === undefined ? Number(t.amount) : t.homeAmount)

export function sumBy(list, type) {
  return list.reduce((acc, t) => {
    if (t.type !== type) return acc
    const v = homeAmountOf(t)
    return v === null ? acc : acc + Number(v)
  }, 0)
}

export function groupByDate(list) {
  const map = new Map()
  for (const t of list) {
    if (!map.has(t.date)) map.set(t.date, [])
    map.get(t.date).push(t)
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
}

// 按分类汇总；超过 maxSlices 个分类时，尾部合并为「其他」，避免颜色被迫循环使用
export function groupByCategory(list, categories, type, maxSlices = 7) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const map = new Map()
  for (const t of list) {
    if (t.type !== type) continue
    const v = homeAmountOf(t)
    if (v === null) continue
    const key = t.categoryId
    map.set(key, (map.get(key) ?? 0) + Number(v))
  }
  const rows = [...map.entries()]
    .map(([id, value]) => {
      const cat = byId.get(id)
      return {
        id,
        name: cat?.name ?? '未分类',
        icon: cat?.icon ?? '❔',
        slot: cat?.slot ?? 0,
        value,
      }
    })
    .sort((a, b) => b.value - a.value)

  if (rows.length <= maxSlices) return rows
  const head = rows.slice(0, maxSlices)
  const tailSum = rows.slice(maxSlices).reduce((a, r) => a + r.value, 0)
  head.push({ id: '__other__', name: '其他分类', icon: '📦', slot: 0, value: tailSum })
  return head
}

export function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
