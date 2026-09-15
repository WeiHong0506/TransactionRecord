/**
 * 固定支出（房租、电话费、停车月票这类每月/每年定额扣款）。
 *
 * 这个模块存在的理由不是「列个清单」，而是让预算说实话：
 * 月底还要扣 RM 1200 房租的话，「还剩 RM 470，日均可花 29」就是个假数。
 * 把未发生的固定支出预留出来，剩下的才是真正能自由花的钱。
 *
 * 纯函数，不碰数据库也不碰 React。
 */

import { homeAmountOf } from './utils.js'

export const CYCLES = [
  { id: 'monthly', label: '每月' },
  { id: 'yearly', label: '每年' },
]

/** 某年某月有几天。用 day 0 拿上个月最后一天，闰年自动正确。 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * 这条固定支出在指定月份的扣款日，没有就返回 null。
 *
 * 关键是**夹紧日期**：房租定在 31 号，2 月只有 28 天——
 * 不夹的话会得到「2月31日」，Date 会把它滚到 3 月 3 日，
 * 于是本月的房租凭空消失，下个月冒出两笔。
 */
export function dueDateIn(rec, month) {
  if (!rec || rec.active === false) return null
  const [y, m] = String(month).split('-').map(Number)
  if (!y || !m) return null

  if (rec.cycle === 'yearly' && Number(rec.month) !== m) return null

  const day = Math.min(Math.max(1, Number(rec.day) || 1), daysInMonth(y, m))
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 从某天往后数，这条固定支出下一次扣款是哪天。找不到返回 null。 */
export function nextDueAfter(rec, from) {
  if (!rec || rec.active === false) return null
  const [fy, fm] = String(from).split('-').map(Number)
  // 每年一次的最多往后找 13 个月就一定能碰到
  for (let i = 0; i < 14; i++) {
    const d = new Date(fy, fm - 1 + i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const due = dueDateIn(rec, month)
    if (due && due >= from) return due
  }
  return null
}

/**
 * 汇总一个月的固定支出情况。
 *
 * 「已发生」靠流水上的 recurringId 精确匹配，不靠金额猜。
 * 猜的话，一笔金额接近的普通居住支出就会被误判成房租已扣，
 * 然后预算里少预留一千多块——这种错比不做还糟。
 */
export function computeRecurring({ recurrings = [], records = [], month, today, fx, home }) {
  const paidBy = new Map()
  for (const t of records) {
    if (t.recurringId && t.month === month) paidBy.set(t.recurringId, t)
  }

  const items = recurrings
    .filter((r) => r.active !== false)
    .map((r) => {
      const due = dueDateIn(r, month)
      const tx = paidBy.get(r.id) ?? null
      const code = r.currency || home
      const rate = code === home ? 1 : Number(fx?.[code])
      const homeAmount =
        Number.isFinite(rate) && rate > 0 ? Number(r.amount) * rate : null
      return {
        ...r,
        due,
        // 本月根本不扣（例如年付的不在这个月）就既不算已付也不算待付
        inMonth: Boolean(due),
        paid: Boolean(tx),
        txId: tx?.id ?? null,
        // 已经发生的按实际扣款金额算，没发生的按设定金额估
        actual: tx ? homeAmountOf(tx) : null,
        homeAmount,
        overdue: Boolean(due && !tx && today && due < today),
      }
    })
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))

  const thisMonth = items.filter((i) => i.inMonth)
  const pending = thisMonth.filter((i) => !i.paid)

  // 汇率算不出来的不计入预留，另外报出来——宁可少预留也不要编一个数
  const unpriced = pending.filter((i) => i.homeAmount === null).length
  const pendingTotal = pending.reduce((a, i) => a + (i.homeAmount ?? 0), 0)

  return {
    items,
    thisMonth,
    pending,
    pendingTotal,
    unpriced,
    paidCount: thisMonth.length - pending.length,
  }
}

/**
 * 可自由支配 = 预算剩余 − 本月还没发生的固定支出。
 *
 * 没设总额预算时返回 null（没有基准就谈不上「还能花多少」）。
 * 预留之后是负数就如实给负数——那正是需要被看见的情况。
 */
export function discretionary(budgetTotal, pendingTotal) {
  if (!budgetTotal || budgetTotal.limit === null) return null
  const left = Number(budgetTotal.left)
  if (!Number.isFinite(left)) return null
  return left - (Number(pendingTotal) || 0)
}

/** 把一条固定支出变成可以直接保存的流水 */
export function toTransaction(rec, month, fallbackAccountId) {
  return {
    type: 'expense',
    amount: Number(rec.amount),
    currency: rec.currency || 'MYR',
    categoryId: rec.categoryId,
    accountId: rec.accountId || fallbackAccountId,
    date: dueDateIn(rec, month),
    note: rec.name,
    // 打上标记，下次就知道这个月这笔已经发生过了
    recurringId: rec.id,
  }
}
