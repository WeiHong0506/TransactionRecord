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

/* ---------------- 日期 ---------------- */

export function todayStr() {
  return toDateStr(new Date())
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

export function sumBy(list, type) {
  return list.reduce((acc, t) => (t.type === type ? acc + Number(t.amount) : acc), 0)
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
    const key = t.categoryId
    map.set(key, (map.get(key) ?? 0) + Number(t.amount))
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
