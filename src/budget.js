/**
 * 预算计算。纯函数，不碰数据库也不碰 React，可以脱离浏览器直接测。
 *
 * 几条贯穿始终的规则：
 *   · 预算只管支出。收入不抵扣预算——这个月多赚了钱不代表可以多花。
 *   · 用的是折算成主货币后的 homeAmount，和统计页同一套口径，
 *     否则「本月已用」和「本月支出」会对不上，那是最容易让人不信任应用的事。
 *   · 汇率没设的记录算不出来，既不计入已用、也不假装成 0，而是单独报出来，
 *     让界面有机会说「还有 N 笔没算进去」。
 */

import { homeAmountOf } from './utils.js'

// 预算行的 id：总额固定叫 total，分类预算直接用分类 id。
// 这样同一条预算在两台设备上编辑时能靠 id 收敛，不会各留一份。
export const TOTAL_ID = 'total'

/** 进度状态。80% 是「该留意了」，100% 是「已经超了」。 */
export function budgetState(used, limit) {
  if (!(limit > 0)) return 'none'
  const pct = used / limit
  if (pct > 1) return 'over'
  if (pct >= 0.8) return 'warn'
  return 'ok'
}

/**
 * 这个月已经过去几天、还剩几天。
 * 看的是「今天」而不是月份本身：翻到过去的月份时，它已经整月结束了。
 */
export function monthProgress(month, today) {
  const [y, m] = String(month).split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const [ty, tm, td] = String(today).split('-').map(Number)

  if (ty > y || (ty === y && tm > m)) return { days, passed: days, left: 0, isCurrent: false }
  if (ty < y || (ty === y && tm < m)) return { days, passed: 0, left: days, isCurrent: false }
  // 今天所在的月份：今天本身算「还能花」的一天，所以 left 至少是 1
  return { days, passed: td - 1, left: days - td + 1, isCurrent: true }
}

/**
 * 把预算行（可能带自己的货币）折算成主货币。
 * 返回 null 表示该货币没设汇率——调用方要把这条预算当作「暂时算不了」。
 */
function limitInHome(row, fx, home) {
  const amount = Number(row?.amount)
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const code = row.currency || home
  if (code === home) return amount
  const r = Number(fx?.[code])
  return Number.isFinite(r) && r > 0 ? amount * r : null
}

/**
 * 算出一个月的预算执行情况。
 *
 * @param records  该月的流水（已挂 homeAmount）
 * @param budgets  预算行数组，每行 { id, amount, currency }
 * @param month    'YYYY-MM'
 * @param today    'YYYY-MM-DD'
 * @param fx/home  汇率表与主货币
 */
export function computeBudget({ records, budgets = [], categories = [], month, today, fx, home }) {
  const byId = new Map(budgets.map((b) => [b.id, b]))
  const expenses = records.filter((t) => t.type === 'expense')

  // 汇率缺失的那几笔：不计入，但要报出来
  const unpriced = expenses.filter((t) => homeAmountOf(t) === null).length
  const priced = expenses.filter((t) => homeAmountOf(t) !== null)

  const usedTotal = priced.reduce((a, t) => a + Number(homeAmountOf(t)), 0)
  const usedByCat = new Map()
  for (const t of priced) {
    usedByCat.set(t.categoryId, (usedByCat.get(t.categoryId) ?? 0) + Number(homeAmountOf(t)))
  }

  const progress = monthProgress(month, today)

  const line = (id, limitRow, used, meta) => {
    const limit = limitInHome(limitRow, fx, home)
    if (limit === null) return { id, ...meta, limit: null, used, unpriced, state: 'none' }
    const left = limit - used
    return {
      id,
      ...meta,
      limit,
      used,
      left,
      pct: limit > 0 ? used / limit : 0,
      state: budgetState(used, limit),
      // 剩下的钱按剩余天数摊，是「今天还能花多少」最直接的答案。
      // 已经超支时给 0 而不是负数——负的日均没有意义。
      perDay: progress.left > 0 ? Math.max(0, left) / progress.left : 0,
    }
  }

  const total = byId.has(TOTAL_ID) ? line(TOTAL_ID, byId.get(TOTAL_ID), usedTotal, {}) : null

  // 只列出真的设了预算的分类，按「超支最多」排前面——要看的就是出问题的那几个
  const perCategory = categories
    .filter((c) => c.type === 'expense' && byId.has(c.id))
    .map((c) =>
      line(c.id, byId.get(c.id), usedByCat.get(c.id) ?? 0, { name: c.name, icon: c.icon, slot: c.slot })
    )
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))

  return { total, perCategory, progress, unpriced, usedTotal }
}
