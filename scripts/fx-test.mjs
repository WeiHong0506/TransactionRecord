/**
 * 多货币逻辑的单元测试。不开浏览器，直接测纯函数 + 一次真实的 IndexedDB 迁移。
 *
 * 这里最重要的不是「折算算得对不对」，而是三件容易出人命的事：
 *   1. 没设汇率时绝不能偷偷按 1:1 混进统计
 *   2. 换主货币时旧汇率必须重新归一，否则所有折算数字一夜之间全错
 *   3. v6 迁移必须把历史记录标成它当初真正的货币
 */
import 'fake-indexeddb/auto'
import {
  DEFAULT_FX,
  groupByCategory,
  homeAmountOf,
  rateOf,
  renormalizeFx,
  sumBy,
  toHome,
} from '../src/utils.js'

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

console.log('\n[1] 汇率查表')
{
  const fx = { MYR: 1, CNY: 0.63 }
  ok('主货币自己恒为 1', rateOf(fx, 'MYR', 'MYR') === 1)
  ok('外币按表取值', rateOf(fx, 'CNY', 'MYR') === 0.63)
  ok('没设汇率返回 null，而不是 1', rateOf(fx, 'SGD', 'MYR') === null)
  ok('汇率为 0 视为未设置', rateOf({ CNY: 0 }, 'CNY', 'MYR') === null)
  ok('负汇率视为未设置', rateOf({ CNY: -1 }, 'CNY', 'MYR') === null)
  ok('汇率是垃圾字符串时视为未设置', rateOf({ CNY: 'abc' }, 'CNY', 'MYR') === null)
  ok('记录没带货币时按主货币处理', rateOf(fx, undefined, 'MYR') === 1)
  ok('¥100 折成 RM63', near(toHome(100, 'CNY', fx, 'MYR'), 63))
  ok('未设汇率折算返回 null', toHome(100, 'SGD', fx, 'MYR') === null)
}

console.log('\n[2] 换主货币时汇率重新归一')
{
  // 1 CNY = 0.63 MYR，主货币从 MYR 换成 CNY 之后，1 MYR 应该 ≈ 1.587 CNY
  const before = { MYR: 1, CNY: 0.63 }
  const after = renormalizeFx(before, 'CNY')
  ok('新主货币自己变成 1', after.CNY === 1)
  ok('旧主货币被正确反转', near(after.MYR, 1 / 0.63, 1e-9), String(after.MYR))
  // 换过去再换回来，应该回到原样——否则来回切几次汇率就漂了
  const back = renormalizeFx(after, 'MYR')
  ok('换回去能还原', near(back.CNY, 0.63, 1e-9) && back.MYR === 1, JSON.stringify(back))

  // 三种货币时，两个外币之间的相对关系必须保持
  const three = { MYR: 1, CNY: 0.63, SGD: 3.3 }
  const inCny = renormalizeFx(three, 'CNY')
  ok(
    '换主货币后 SGD/MYR 的相对关系不变',
    near(inCny.SGD / inCny.MYR, three.SGD / three.MYR, 1e-9)
  )

  const missing = renormalizeFx({ MYR: 1 }, 'CNY')
  ok('换到一个没设汇率的货币时，至少保证它自己是 1', missing.CNY === 1)
}

console.log('\n[3] 统计跳过算不出来的记录，而不是按原值混进去')
{
  const home = 'MYR'
  const fx = { MYR: 1, CNY: 0.63 }
  const price = (t) => {
    const r = rateOf(fx, t.currency, home)
    return { ...t, homeAmount: r === null ? null : t.amount * r }
  }
  const records = [
    price({ type: 'expense', amount: 100, currency: 'MYR', categoryId: 'exp-food' }),
    price({ type: 'expense', amount: 100, currency: 'CNY', categoryId: 'exp-food' }),
    price({ type: 'expense', amount: 100, currency: 'SGD', categoryId: 'exp-food' }), // 没汇率
    price({ type: 'income', amount: 200, currency: 'CNY', categoryId: 'inc-salary' }),
  ]
  ok('支出 = 100 + 63，未设汇率那笔被跳过', near(sumBy(records, 'expense'), 163))
  ok('收入按汇率折算', near(sumBy(records, 'income'), 126))

  const rows = groupByCategory(records, [{ id: 'exp-food', name: '餐饮', icon: '🍜', slot: 1 }], 'expense')
  ok('分类汇总同样跳过未设汇率的', near(rows[0].value, 163), String(rows[0].value))

  // 最容易出的错：SGD 那笔按 100 原值混进来，总数变成 263
  ok('未设汇率的记录没有按原值混进总数', !near(sumBy(records, 'expense'), 263))

  // 老数据没有 homeAmount 字段时必须退回原值，不能当成 null 全部丢掉
  ok('没有 homeAmount 字段的记录按原值计', homeAmountOf({ amount: 50 }) === 50)
  ok('homeAmount 为 null 时明确返回 null', homeAmountOf({ amount: 50, homeAmount: null }) === null)
  ok('DEFAULT_FX 里主货币是 1', DEFAULT_FX.MYR === 1)
}

console.log('\n[4] v6 迁移：历史记录要认得自己当初是什么货币')
{
  // 先手工造一个 v5 的库，模拟老用户
  const { openDB, deleteDB } = await import('idb')
  await deleteDB('transaction-record')
  const old = await openDB('transaction-record', 5, {
    upgrade(db) {
      const t = db.createObjectStore('transactions', { keyPath: 'id' })
      t.createIndex('by-date', 'date')
      t.createIndex('by-month', 'month')
      t.createIndex('by-category', 'categoryId')
      db.createObjectStore('categories', { keyPath: 'id' })
      db.createObjectStore('settings', { keyPath: 'key' })
      db.createObjectStore('accounts', { keyPath: 'id' })
    },
  })
  await old.put('settings', { key: 'currency', value: 'MYR' })
  await old.put('accounts', { id: 'acc-cash', name: '现金', initialBalance: 500, order: 1 })
  await old.put('transactions', {
    id: 't1',
    type: 'expense',
    amount: 38.5,
    categoryId: 'exp-food',
    accountId: 'acc-cash',
    date: '2026-09-01',
    month: '2026-09',
  })
  old.close()

  // 走真正的 db.js，触发 v6 迁移
  const db = await import('../src/db.js')
  const accounts = await db.getAccounts()
  const txs = await db.getAllTransactions()
  ok('历史账户被标成迁移前的那个货币', accounts[0]?.currency === 'MYR', accounts[0]?.currency)
  ok('历史流水被标成迁移前的那个货币', txs[0]?.currency === 'MYR', txs[0]?.currency)
  ok('金额本身没有被改动', txs[0]?.amount === 38.5)
  const fx = await db.getSetting('fx', null)
  ok('迁移后汇率表里主货币是 1', fx?.MYR === 1, JSON.stringify(fx))

  // 新存的记录必须带上货币
  const saved = await db.saveTransaction({
    type: 'expense',
    amount: 45,
    categoryId: 'exp-food',
    accountId: 'acc-cny',
    currency: 'CNY',
    date: '2026-09-10',
  })
  ok('新记录保留传入的货币', saved.currency === 'CNY')
  const acc = await db.saveAccount({ name: '支付宝', icon: '📱', currency: 'CNY', initialBalance: 0 })
  ok('新账户保留传入的货币', acc.currency === 'CNY')
  const acc2 = await db.saveAccount({ name: '无币账户', icon: '💳', initialBalance: 0 })
  ok('没传货币的账户回退到 MYR', acc2.currency === 'MYR')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
