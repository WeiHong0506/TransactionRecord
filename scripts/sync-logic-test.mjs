// 同步核心逻辑的单元测试：冲突合并、软删除墓碑、脏标记。
// 不联网——用内存版 IndexedDB 跑本地数据层。
//
// 用法：
//   npm i -D fake-indexeddb
//   node scripts/sync-logic-test.mjs
import 'fake-indexeddb/auto'

const db = await import('../src/db.js')

let pass = 0
let fail = 0

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const tx = (over = {}) => ({
  type: 'expense',
  amount: 10,
  categoryId: 'exp-food',
  note: '',
  date: '2026-09-01',
  ...over,
})

console.log('\n[1] 本地写入会打上待上传标记')
await db.initCategories()
const a = await db.saveTransaction(tx({ id: 'a', note: '本地原始' }))
check('新记录 dirty=1', a.dirty === 1)
check('新记录无墓碑', a.deletedAt === null)
check('待上传列表包含它', (await db.getDirty('transactions')).some((r) => r.id === 'a'))

console.log('\n[2] 上传成功后清除标记')
await db.clearDirty('transactions', [{ id: 'a', updatedAt: a.updatedAt }])
check('dirty 已清除', (await db.getDirty('transactions')).length === 0)

console.log('\n[3] 上传期间又改了本地 → 标记必须保留')
const b = await db.saveTransaction(tx({ id: 'b', note: 'v1' }))
const staleStamp = b.updatedAt
await new Promise((r) => setTimeout(r, 5))
await db.saveTransaction({ ...b, note: 'v2' }) // 上传还在路上时用户又编辑了
await db.clearDirty('transactions', [{ id: 'b', updatedAt: staleStamp }]) // 旧那次上传回来了
check(
  '仍在待上传队列（否则 v2 会永远传不上去）',
  (await db.getDirty('transactions')).some((r) => r.id === 'b')
)

console.log('\n[4] 冲突合并：后写优先')
const local = await db.saveTransaction(tx({ id: 'c', note: '本地较新' }))
await db.mergeRemote('transactions', [
  { ...tx({ id: 'c', note: '云端较旧' }), updatedAt: local.updatedAt - 1000, deletedAt: null },
])
let c = (await db.getAllTransactions()).find((r) => r.id === 'c')
check('云端较旧 → 保留本地', c.note === '本地较新', `实际 ${c?.note}`)

await db.mergeRemote('transactions', [
  { ...tx({ id: 'c', note: '云端较新' }), updatedAt: local.updatedAt + 1000, deletedAt: null },
])
c = (await db.getAllTransactions()).find((r) => r.id === 'c')
check('云端较新 → 采用云端', c.note === '云端较新', `实际 ${c?.note}`)
check('采用云端后不再重复上传', !(await db.getDirty('transactions')).some((r) => r.id === 'c'))

console.log('\n[5] 删除会立墓碑并传播')
await db.deleteTransaction('a')
const raw = (await db.getDirty('transactions')).find((r) => r.id === 'a')
check('墓碑进入待上传队列', Boolean(raw?.deletedAt))
check('列表里已看不到', !(await db.getAllTransactions()).some((r) => r.id === 'a'))

console.log('\n[6] 云端来的删除会应用到本地')
const d = await db.saveTransaction(tx({ id: 'd', note: '将被别的设备删掉' }))
check('先确认存在', (await db.getAllTransactions()).some((r) => r.id === 'd'))
await db.mergeRemote('transactions', [
  { ...tx({ id: 'd' }), updatedAt: d.updatedAt + 1000, deletedAt: d.updatedAt + 1000 },
])
check('本地也消失了', !(await db.getAllTransactions()).some((r) => r.id === 'd'))

console.log('\n[7] 清空全部数据 = 立墓碑而不是直接删')
await db.saveTransaction(tx({ id: 'e' }))
await db.clearAllData()
const dirtyAfter = await db.getDirty('transactions')
check('流水全部变成墓碑', dirtyAfter.length > 0 && dirtyAfter.every((r) => r.deletedAt))
check('界面上一条不剩', (await db.getAllTransactions()).length === 0)
const cats = await db.getCategories()
check('默认分类已复活', cats.length > 0 && cats.some((c) => c.id === 'exp-food'))
check('复活的分类会上传', (await db.getDirty('categories')).some((c) => c.id === 'exp-food'))

console.log('\n[8] 墓碑在同步完成且过期后才清理')
const all = await db.getDirty('transactions')
await db.clearDirty('transactions', all.map(({ id, updatedAt }) => ({ id, updatedAt })))
await db.purgeTombstones(0) // 保留期设为 0，模拟 30 天后
check('已同步的旧墓碑被清掉', (await db.getDirty('transactions')).length === 0)

console.log('\n[9] 上传载荷里绝不能出现 null 时间戳（云端是非空列）')
// 回归测试：v2 升级漏补 createdAt，导致老分类上传时发送 null，整批被拒
const { txToRemote, catToRemote } = await import('../src/sync.js')
const legacyCat = { id: 'exp-food', name: '餐饮', icon: '🍜', type: 'expense', slot: 1, order: 1 }
const legacyTx = { id: 'x', type: 'expense', amount: 1, categoryId: 'exp-food', date: '2026-01-01' }
const payloads = [catToRemote(legacyCat, 'u1'), txToRemote(legacyTx, 'u1')]
for (const [i, p] of payloads.entries()) {
  const label = i === 0 ? '分类' : '流水'
  check(`${label} created_at 非空`, p.created_at !== null && p.created_at !== undefined)
  check(`${label} updated_at 非空`, p.updated_at !== null && p.updated_at !== undefined)
  check(`${label} deleted_at 为 null（未删除）`, p.deleted_at === null)
}

console.log('\n[10] 数据库升级会把老记录的 createdAt 补齐')
const upgraded = await db.getDirty('categories')
check(
  '所有分类都有 createdAt',
  upgraded.length > 0 && upgraded.every((c) => typeof c.createdAt === 'number')
)

console.log('\n[11] 预算也要参与同步')
{
  const { budgetToRemote } = await import('../src/sync.js')
  const row = budgetToRemote(
    { id: 'exp-food', amount: 800, currency: 'MYR', createdAt: 1, updatedAt: 2, deletedAt: null },
    'user-1'
  )
  check('预算上传载荷带 user_id', row.user_id === 'user-1')
  check('id 用的是分类 id，不是随机 UUID', row.id === 'exp-food', row.id)
  check('金额和货币都在', row.amount === 800 && row.currency === 'MYR')
  check('created_at 非空', typeof row.created_at === 'string' && row.created_at.length > 0)
  check('updated_at 非空', typeof row.updated_at === 'string' && row.updated_at.length > 0)
  check('未删除时 deleted_at 为 null', row.deleted_at === null)

  const tomb = budgetToRemote(
    { id: 'total', amount: 0, currency: 'MYR', createdAt: 1, updatedAt: 9, deletedAt: 9 },
    'user-1'
  )
  check('清空预算是立墓碑而不是 amount=0', tomb.deleted_at !== null)

  const db = await import('../src/db.js')
  await db.saveBudget('exp-food', 800, 'MYR')
  check('存得进去', (await db.getBudgets()).some((b) => b.id === 'exp-food' && b.amount === 800))
  await db.saveBudget('exp-food', 0, 'MYR')
  const after = await db.getBudgets()
  check('清空后不再出现在列表里', !after.some((b) => b.id === 'exp-food'))
}

console.log('\n[12] 固定支出与它在流水上的标记')
{
  const { recToRemote, txToRemote } = await import('../src/sync.js')
  const db = await import('../src/db.js')

  const saved = await db.saveRecurring({
    name: '房租',
    amount: 1200,
    currency: 'MYR',
    categoryId: 'exp-housing',
    cycle: 'monthly',
    // 存的是原始设定 31，不能被夹到 28——否则 2 月过一次之后就再也回不去了
    day: 31,
  })
  check('31 号原样存下，不在写库时夹紧', saved.day === 31, String(saved.day))
  check('每月一次时 month 是 null', saved.month === null, String(saved.month))
  check('默认启用', saved.active === true)
  check('读得回来', (await db.getRecurrings()).some((r) => r.id === saved.id))

  const row = recToRemote(saved, 'user-1')
  check('上传载荷带 user_id', row.user_id === 'user-1')
  check('周期和扣款日都在', row.cycle === 'monthly' && row.day === 31)
  check('每月一次的 month 发 null，不发 0', row.month === null, String(row.month))
  check('created_at / updated_at 都非空', Boolean(row.created_at && row.updated_at))
  check('未删除时 deleted_at 为 null', row.deleted_at === null)

  const yearly = recToRemote(
    { id: 'y', name: '车险', amount: 900, cycle: 'yearly', month: 3, day: 15, updatedAt: 1 },
    'user-1'
  )
  check('年付才带月份', yearly.month === 3)

  // 一键记账写出来的流水必须带 recurring_id，否则下个月认不出「这笔扣过了」，
  // 预算会把同一笔房租再预留一次。
  const tx = await db.saveTransaction({
    type: 'expense',
    amount: 1200,
    currency: 'MYR',
    categoryId: 'exp-housing',
    accountId: 'acc-cash',
    date: '2026-09-28',
    recurringId: saved.id,
  })
  check('流水上留下了来源标记', tx.recurringId === saved.id)
  check('上传时映射成 recurring_id', txToRemote(tx, 'user-1').recurring_id === saved.id)

  const plain = await db.saveTransaction({
    type: 'expense',
    amount: 12,
    currency: 'MYR',
    categoryId: 'exp-food',
    accountId: 'acc-cash',
    date: '2026-09-02',
  })
  check('普通记账的标记是 null，不是 undefined', plain.recurringId === null)
  check('null 也要如实发上去', txToRemote(plain, 'user-1').recurring_id === null)

  await db.deleteRecurring(saved.id)
  check('删除是立墓碑，列表里不再出现', !(await db.getRecurrings()).some((r) => r.id === saved.id))
  const stillThere = (await db.getAllTransactions()).some((t) => t.id === tx.id)
  check('删掉固定支出不会连带删掉已经记过的流水', stillThere)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
