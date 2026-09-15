/**
 * 预算逻辑测试。纯函数，不开浏览器。
 *
 * 盯的是三件最容易算错的事：
 *   1. 收入不能抵扣预算——这个月多赚了不代表可以多花
 *   2. 「今天」也算能花的一天，否则月末最后一天日均会变成除以零
 *   3. 汇率缺失的记录不能悄悄按 0 计入，那会让人以为自己还有余额
 */
import { TOTAL_ID, budgetState, computeBudget, monthProgress } from '../src/budget.js'

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

const CATS = [
  { id: 'exp-food', name: '餐饮', icon: '🍜', type: 'expense', slot: 1 },
  { id: 'exp-transport', name: '交通', icon: '🚌', type: 'expense', slot: 2 },
  { id: 'exp-fun', name: '娱乐', icon: '🎮', type: 'expense', slot: 5 },
  { id: 'inc-salary', name: '工资', icon: '💰', type: 'income', slot: 1 },
]
const ex = (categoryId, amount, homeAmount = amount) => ({
  type: 'expense', categoryId, amount, homeAmount,
})
const inc = (amount) => ({ type: 'income', categoryId: 'inc-salary', amount, homeAmount: amount })

const run = (over = {}) =>
  computeBudget({
    records: [], budgets: [], categories: CATS,
    month: '2026-09', today: '2026-09-15', fx: { MYR: 1 }, home: 'MYR',
    ...over,
  })

console.log('\n[1] 月份进度')
{
  ok('9 月有 30 天', monthProgress('2026-09', '2026-09-15').days === 30)
  ok('9/15 已过 14 天', monthProgress('2026-09', '2026-09-15').passed === 14)
  ok('9/15 还剩 16 天（含今天）', monthProgress('2026-09', '2026-09-15').left === 16)
  ok('月初第一天还剩满月', monthProgress('2026-09', '2026-09-01').left === 30)
  // 最后一天必须还剩 1 天，否则日均要除以零
  ok('最后一天还剩 1 天，不是 0', monthProgress('2026-09', '2026-09-30').left === 1)
  ok('2 月闰年 29 天', monthProgress('2028-02', '2028-02-10').days === 29)
  ok('2 月平年 28 天', monthProgress('2026-02', '2026-02-10').days === 28)
  ok('看过去的月份：已经过完', monthProgress('2026-08', '2026-09-15').left === 0)
  ok('看未来的月份：一天没过', monthProgress('2026-10', '2026-09-15').passed === 0)
  ok('只有当月标记 isCurrent', monthProgress('2026-09', '2026-09-15').isCurrent === true)
  ok('过去的月份不是当月', monthProgress('2026-08', '2026-09-15').isCurrent === false)
}

console.log('\n[2] 状态分档')
{
  ok('没设预算是 none', budgetState(100, 0) === 'none')
  ok('五成是 ok', budgetState(50, 100) === 'ok')
  ok('79% 还是 ok', budgetState(79, 100) === 'ok')
  ok('80% 开始警示', budgetState(80, 100) === 'warn')
  ok('刚好用完不算超支', budgetState(100, 100) === 'warn')
  ok('超一分就是 over', budgetState(100.01, 100) === 'over')
}

console.log('\n[3] 总额预算')
{
  const r = run({
    records: [ex('exp-food', 300), ex('exp-transport', 200)],
    budgets: [{ id: TOTAL_ID, amount: 1000 }],
  })
  ok('已用 500', near(r.total.used, 500))
  ok('剩余 500', near(r.total.left, 500))
  ok('进度 50%', near(r.total.pct, 0.5))
  ok('状态 ok', r.total.state === 'ok')
  // 9/15 还剩 16 天，500 / 16 = 31.25
  ok('日均可花 31.25', near(r.total.perDay, 31.25), String(r.total.perDay))

  // 收入绝不能抵扣预算
  const withIncome = run({
    records: [ex('exp-food', 300), inc(5000)],
    budgets: [{ id: TOTAL_ID, amount: 1000 }],
  })
  ok('收入不抵扣预算，已用仍是 300', near(withIncome.total.used, 300))

  const over = run({
    records: [ex('exp-food', 1200)],
    budgets: [{ id: TOTAL_ID, amount: 1000 }],
  })
  ok('超支时 left 为负', near(over.total.left, -200))
  ok('超支时状态 over', over.total.state === 'over')
  ok('超支时日均给 0 而不是负数', over.total.perDay === 0)

  ok('没设总额预算时 total 为 null', run({ records: [ex('exp-food', 10)] }).total === null)
}

console.log('\n[4] 分类预算')
{
  const r = run({
    records: [ex('exp-food', 900), ex('exp-transport', 100), ex('exp-fun', 50)],
    budgets: [
      { id: TOTAL_ID, amount: 2000 },
      { id: 'exp-food', amount: 1000 },
      { id: 'exp-transport', amount: 500 },
    ],
  })
  ok('只列出设了预算的分类', r.perCategory.length === 2)
  ok('没设预算的娱乐不出现', !r.perCategory.some((x) => x.id === 'exp-fun'))
  ok('餐饮排在前面（用得更满）', r.perCategory[0].id === 'exp-food')
  ok('餐饮 90%', near(r.perCategory[0].pct, 0.9))
  ok('餐饮进入警示区', r.perCategory[0].state === 'warn')
  ok('交通 20%，状态 ok', r.perCategory[1].state === 'ok')
  ok('带上了分类名和图标', r.perCategory[0].name === '餐饮' && r.perCategory[0].icon === '🍜')

  // 分类没有支出时应当是 0 而不是缺失
  const empty = run({ records: [], budgets: [{ id: 'exp-food', amount: 300 }] })
  ok('没花钱的分类已用为 0', empty.perCategory[0].used === 0)
  ok('没花钱时日均 = 预算/剩余天数', near(empty.perCategory[0].perDay, 300 / 16))

  // 收入分类即使设了预算也不该出现——预算只管支出
  const incomeBudget = run({ budgets: [{ id: 'inc-salary', amount: 999 }] })
  ok('收入分类不进预算列表', incomeBudget.perCategory.length === 0)
}

console.log('\n[5] 多货币')
{
  // 记录已经折算好（homeAmount），预算本身也可能是用外币设的
  const r = computeBudget({
    records: [ex('exp-food', 100, 63)], // ¥100 = RM63
    budgets: [{ id: TOTAL_ID, amount: 1000, currency: 'CNY' }],
    categories: CATS, month: '2026-09', today: '2026-09-15',
    fx: { MYR: 1, CNY: 0.63 }, home: 'MYR',
  })
  ok('外币预算按汇率折成主货币', near(r.total.limit, 630), String(r.total.limit))
  ok('已用取的是折算后的金额', near(r.total.used, 63))

  const noRate = computeBudget({
    records: [], budgets: [{ id: TOTAL_ID, amount: 1000, currency: 'SGD' }],
    categories: CATS, month: '2026-09', today: '2026-09-15',
    fx: { MYR: 1 }, home: 'MYR',
  })
  ok('预算货币没设汇率时 limit 为 null', noRate.total.limit === null)
  ok('算不出来时状态是 none，不装作 0', noRate.total.state === 'none')
}

console.log('\n[6] 汇率缺失的记录要报出来，不能当 0')
{
  const r = computeBudget({
    records: [ex('exp-food', 100, 100), { type: 'expense', categoryId: 'exp-food', amount: 50, homeAmount: null }],
    budgets: [{ id: TOTAL_ID, amount: 1000 }],
    categories: CATS, month: '2026-09', today: '2026-09-15',
    fx: { MYR: 1 }, home: 'MYR',
  })
  ok('算不出来的那笔没混进已用', near(r.total.used, 100))
  ok('但要报出有 1 笔没算进去', r.unpriced === 1)
  ok('没有把它当成 0 悄悄忽略', r.total.used !== 150 && r.unpriced > 0)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
