/**
 * 和上月对比。
 *
 * 把数字变成洞察的其实不是 AI，是对比——孤立的「本月餐饮 920」什么都说明不了，
 * 「比上月多了三分之一」立刻就有含义。
 *
 * 纯函数，用的是折算后的 homeAmount，和统计页同一口径。
 */

import { homeAmountOf, shiftMonth } from './utils.js'

function sumByCategory(records, month) {
  const map = new Map()
  for (const t of records) {
    if (t.month !== month || t.type !== 'expense') continue
    const v = homeAmountOf(t)
    if (v === null) continue
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + Number(v))
  }
  return map
}

/**
 * 逐分类对比本月和上月的支出。
 *
 * 只比支出：收入的波动（发薪日落在哪个月、有没有奖金）和「花钱习惯变了没有」
 * 是两回事，混在一起看只会互相干扰。
 *
 * delta 为正 = 比上月花得多。pct 在上月为 0 时返回 null 而不是 Infinity——
 * 「从 0 涨到 50」没有百分比可言，界面上应该显示「新增」。
 */
export function compareMonths(records, month, categories = []) {
  const prev = shiftMonth(month, -1)
  const cur = sumByCategory(records, month)
  const old = sumByCategory(records, prev)
  const byId = new Map(categories.map((c) => [c.id, c]))

  const ids = new Set([...cur.keys(), ...old.keys()])
  const rows = [...ids].map((id) => {
    const now = cur.get(id) ?? 0
    const before = old.get(id) ?? 0
    const delta = now - before
    return {
      id,
      name: byId.get(id)?.name ?? '未分类',
      icon: byId.get(id)?.icon ?? '❔',
      slot: byId.get(id)?.slot ?? 0,
      now,
      before,
      delta,
      pct: before > 0 ? delta / before : null,
      isNew: before === 0 && now > 0,
      isGone: now === 0 && before > 0,
    }
  })

  // 按变化绝对值排序：要看的是变得最多的那几个，不是花得最多的
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  const totalNow = [...cur.values()].reduce((a, b) => a + b, 0)
  const totalBefore = [...old.values()].reduce((a, b) => a + b, 0)

  return {
    prevMonth: prev,
    rows,
    totalNow,
    totalBefore,
    totalDelta: totalNow - totalBefore,
    totalPct: totalBefore > 0 ? (totalNow - totalBefore) / totalBefore : null,
    // 上月一笔都没有时，对比没有意义，界面直接不显示
    comparable: totalBefore > 0,
  }
}
