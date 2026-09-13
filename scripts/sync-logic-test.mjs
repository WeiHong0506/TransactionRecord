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

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
