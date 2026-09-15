/**
 * 固定支出 + 月度对比的测试。纯函数，不开浏览器。
 *
 * 盯的是几个会直接算错钱的地方：
 *   1. 日期夹紧——房租定在 31 号，2 月必须落在 28/29 号，不能滚到 3 月
 *   2. 「已发生」靠 recurringId 精确匹配，不靠金额猜
 *   3. 可自由支配 = 预算剩余 − 未发生的固定支出，负数要如实给负数
 *   4. 上月为 0 时百分比返回 null，不是 Infinity
 */
import {
  computeRecurring,
  discretionary,
  daysInMonth,
  dueDateIn,
  nextDueAfter,
  toTransaction,
} from '../src/recurring.js'
import { compareMonths } from '../src/compare.js'

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// 用户真实的三笔
const RENT = { id: 'r-rent', name: '房租', amount: 1200, currency: 'MYR', categoryId: 'exp-housing', cycle: 'monthly', day: 28 }
const PHONE = { id: 'r-phone', name: '电话费', amount: 58, currency: 'MYR', categoryId: 'exp-comm', cycle: 'monthly', day: 5 }
const PARK = { id: 'r-park', name: 'Amano 停车', amount: 150, currency: 'MYR', categoryId: 'exp-transport', cycle: 'monthly', day: 1 }
const ALL = [RENT, PHONE, PARK]

console.log('\n[1] 扣款日与日期夹紧')
{
  ok('9 月 30 天', daysInMonth(2026, 9) === 30)
  ok('2026 年 2 月 28 天', daysInMonth(2026, 2) === 28)
  ok('2028 年 2 月 29 天（闰年）', daysInMonth(2028, 2) === 29)

  ok('房租 28 号', dueDateIn(RENT, '2026-09') === '2026-09-28')
  const end = { ...RENT, day: 31 }
  ok('31 号在 9 月夹到 30 号', dueDateIn(end, '2026-09') === '2026-09-30')
  ok('31 号在 2 月夹到 28 号', dueDateIn(end, '2026-02') === '2026-02-28')
  ok('31 号在闰年 2 月夹到 29 号', dueDateIn(end, '2028-02') === '2028-02-29')
  ok('31 号在 12 月就是 31 号', dueDateIn(end, '2026-12') === '2026-12-31')
  // 不夹的话 new Date(2026,1,31) 会滚到 3 月 3 日，本月这笔就凭空消失
  ok('夹紧后绝不会滚进下个月', dueDateIn(end, '2026-02').startsWith('2026-02'))

  ok('day 为 0 视为 1 号', dueDateIn({ ...RENT, day: 0 }, '2026-09') === '2026-09-01')
  ok('停用的不返回日期', dueDateIn({ ...RENT, active: false }, '2026-09') === null)

  const yearly = { id: 'y', amount: 300, cycle: 'yearly', month: 3, day: 15 }
  ok('年付只在对应月份出现', dueDateIn(yearly, '2026-03') === '2026-03-15')
  ok('年付在别的月份为 null', dueDateIn(yearly, '2026-09') === null)
}

console.log('\n[2] 下一次扣款')
{
  ok('月中往后找到本月的', nextDueAfter(RENT, '2026-09-10') === '2026-09-28')
  ok('过了扣款日就找下个月', nextDueAfter(RENT, '2026-09-29') === '2026-10-28')
  ok('当天算数', nextDueAfter(RENT, '2026-09-28') === '2026-09-28')
  const yearly = { id: 'y', amount: 300, cycle: 'yearly', month: 3, day: 15 }
  ok('年付能跨年找到', nextDueAfter(yearly, '2026-09-01') === '2027-03-15')
}

console.log('\n[3] 本月汇总：已发生 vs 待扣')
{
  const base = { recurrings: ALL, month: '2026-09', today: '2026-09-15', fx: { MYR: 1 }, home: 'MYR' }

  const none = computeRecurring({ ...base, records: [] })
  ok('三笔都待扣', none.pending.length === 3)
  ok('待扣合计 1408', near(none.pendingTotal, 1408))
  ok('按扣款日排序：停车(1) → 电话(5) → 房租(28)', none.items.map((i) => i.id).join() === 'r-park,r-phone,r-rent')
  ok('15 号时，1 号和 5 号已逾期', none.items.filter((i) => i.overdue).length === 2)
  ok('28 号那笔还没到期', none.items.find((i) => i.id === 'r-rent').overdue === false)

  // 已发生靠 recurringId 精确匹配
  const paid = computeRecurring({
    ...base,
    records: [
      { id: 't1', month: '2026-09', type: 'expense', amount: 58, homeAmount: 58, recurringId: 'r-phone' },
    ],
  })
  ok('标记了 recurringId 的算已发生', paid.items.find((i) => i.id === 'r-phone').paid === true)
  ok('已发生的不再计入待扣', near(paid.pendingTotal, 1350))
  ok('已发生计数正确', paid.paidCount === 1)

  // 金额接近但没标记的，绝不能被误判成已扣
  const decoy = computeRecurring({
    ...base,
    records: [
      { id: 't2', month: '2026-09', type: 'expense', amount: 1200, homeAmount: 1200, categoryId: 'exp-housing' },
    ],
  })
  ok('金额一样但没 recurringId 的不算房租已扣', decoy.items.find((i) => i.id === 'r-rent').paid === false)
  ok('所以待扣仍是全额', near(decoy.pendingTotal, 1408))

  // 上个月标记过的，不该影响本月
  const lastMonth = computeRecurring({
    ...base,
    records: [{ id: 't3', month: '2026-08', type: 'expense', amount: 1200, recurringId: 'r-rent' }],
  })
  ok('上月已扣不影响本月', lastMonth.items.find((i) => i.id === 'r-rent').paid === false)

  const off = computeRecurring({ ...base, recurrings: [{ ...RENT, active: false }, PHONE] })
  ok('停用的完全不出现', off.items.length === 1)
}

console.log('\n[4] 外币固定支出')
{
  const usd = { id: 'r-icloud', name: 'iCloud', amount: 10, currency: 'USD', cycle: 'monthly', day: 20 }
  const withRate = computeRecurring({
    recurrings: [usd], records: [], month: '2026-09', today: '2026-09-01',
    fx: { MYR: 1, USD: 4.4 }, home: 'MYR',
  })
  ok('按汇率折算成主货币', near(withRate.pendingTotal, 44))

  const noRate = computeRecurring({
    recurrings: [usd], records: [], month: '2026-09', today: '2026-09-01',
    fx: { MYR: 1 }, home: 'MYR',
  })
  ok('没设汇率时不计入预留', noRate.pendingTotal === 0)
  ok('但要报出来有 1 笔算不了', noRate.unpriced === 1)
}

console.log('\n[5] 可自由支配 = 预算剩余 − 未发生的固定支出')
{
  // 预算 2000，已花 1530，剩 470；但月底还有 1200 房租
  const budgetTotal = { limit: 2000, used: 1530, left: 470 }
  ok('预留之后是 −730，如实给负数', near(discretionary(budgetTotal, 1200), -730))
  ok('没有待扣时就等于预算剩余', near(discretionary(budgetTotal, 0), 470))
  ok('没设预算时返回 null', discretionary(null, 1200) === null)
  ok('预算算不出来时返回 null', discretionary({ limit: null }, 1200) === null)
}

console.log('\n[6] 一键记账的载荷')
{
  const tx = toTransaction(RENT, '2026-09', 'acc-cash')
  ok('类型是支出', tx.type === 'expense')
  ok('金额和分类来自设定', tx.amount === 1200 && tx.categoryId === 'exp-housing')
  ok('日期就是扣款日', tx.date === '2026-09-28')
  ok('备注用名称', tx.note === '房租')
  ok('打上 recurringId，下次才认得出已发生', tx.recurringId === 'r-rent')
  ok('没指定账户时回退到默认', toTransaction(PHONE, '2026-09', 'acc-cash').accountId === 'acc-cash')
}

console.log('\n[7] 和上月对比')
{
  const cats = [
    { id: 'exp-food', name: '餐饮', icon: '🍜', slot: 1 },
    { id: 'exp-fun', name: '娱乐', icon: '🎮', slot: 5 },
    { id: 'exp-travel', name: '旅行', icon: '✈️', slot: 6 },
  ]
  const ex = (month, categoryId, amount) => ({ month, type: 'expense', categoryId, amount, homeAmount: amount })
  const records = [
    ex('2026-09', 'exp-food', 920),
    ex('2026-09', 'exp-travel', 500),
    ex('2026-08', 'exp-food', 600),
    ex('2026-08', 'exp-fun', 200),
    // 收入不该进对比
    { month: '2026-09', type: 'income', categoryId: 'inc-salary', amount: 5000, homeAmount: 5000 },
  ]
  const c = compareMonths(records, '2026-09', cats)

  ok('上月是 2026-08', c.prevMonth === '2026-08')
  ok('本月总支出 1420', near(c.totalNow, 1420))
  ok('上月总支出 800', near(c.totalBefore, 800))
  ok('总变化 +620', near(c.totalDelta, 620))
  ok('收入没有混进对比', !near(c.totalNow, 6420))

  const food = c.rows.find((r) => r.id === 'exp-food')
  ok('餐饮 +320', near(food.delta, 320))
  ok('餐饮涨了 53%', near(food.pct, 320 / 600))

  const travel = c.rows.find((r) => r.id === 'exp-travel')
  ok('旅行是新增的', travel.isNew === true)
  ok('新增的百分比为 null，不是 Infinity', travel.pct === null)

  const fun = c.rows.find((r) => r.id === 'exp-fun')
  ok('娱乐本月归零，标记为消失', fun.isGone === true)
  ok('娱乐 −200', near(fun.delta, -200))

  // 排的是「变得最多」而不是「花得最多」：旅行 +500 > 餐饮 +320 > 娱乐 −200。
  // 本月花最多的是餐饮 920，但它不该排第一——这一条就是用来钉住这个区别的。
  ok('按变化绝对值排序，不是按金额', c.rows.map((r) => r.id).join() === 'exp-travel,exp-food,exp-fun')

  const noPrev = compareMonths([ex('2026-09', 'exp-food', 100)], '2026-09', cats)
  ok('上月没数据时标记为不可比', noPrev.comparable === false)
  ok('不可比时总百分比为 null', noPrev.totalPct === null)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
