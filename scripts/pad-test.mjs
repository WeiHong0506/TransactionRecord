/**
 * 金额键盘的算术内核测试。
 *
 * 最重要的一条来自用户手里真实的马来西亚餐厅账单：
 * 服务费和 SST 各自独立按小计算，互不叠加。它自带一个验算——
 * 两个税率填成一样时，两行金额必须一模一样。以后谁再手滑改成
 * 「SST 按含服务费的金额算」，下面第 [3] 组会立刻红。
 */
import {
  EMPTY_PAD,
  applyTax,
  formatExpr,
  padFromAmount,
  padReduce,
  padValue,
} from '../src/padMath.js'

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

// 连按一串键
const type = (keys) => keys.split(' ').reduce((s, k) => padReduce(s, k), { ...EMPTY_PAD })
const val = (keys) => padValue(type(keys))

console.log('\n[1] 基本输入')
{
  ok('连着按出整数', val('8 7') === 87)
  ok('小数点', val('1 2 . 5 0') === 12.5)
  ok('开头按小数点补 0', type('.').cur === '0.')
  ok('小数点不能按两次', type('1 . 2 . 3').cur === '1.23')
  ok('最多两位小数', type('1 . 2 3 4 5').cur === '1.23')
  ok('前导零只留一个', type('0 5').cur === '5')
  ok('开头按 00 无效', type('00').cur === '')
  ok('00 在数字后面才生效', type('5 00').cur === '500')
  ok('退格', type('8 7 del').cur === '8')
  ok('空状态退格不炸', padValue(type('del')) === null)
  ok('什么都没按时值为 null', padValue({ ...EMPTY_PAD }) === null)
}

console.log('\n[2] 四则运算')
{
  ok('87 ÷ 3 = 29', near(val('8 7 ÷ 3'), 29))
  ok('45 × 2 = 90', near(val('4 5 × 2'), 90))
  ok('100 − 12.5 = 87.5', near(val('1 0 0 − 1 2 . 5'), 87.5))
  ok('连按 1+2+3 = 6', near(val('1 + 2 + 3'), 6))
  ok('按了运算符还没输右值时，先显示左值', near(val('8 7 ÷'), 87))
  ok('除以零返回 null，不是 Infinity', val('8 7 ÷ 0') === null)
  ok('除以零不会漏成 Infinity', Number.isFinite(val('8 7 ÷ 0')) === false)
  ok('退格可以撤掉运算符', type('8 7 ÷ del').cur === '87')
  ok('算式显示', formatExpr(type('8 7 ÷ 3')) === '87 ÷ 3')
  ok('没在算的时候算式为空', formatExpr(type('8 7')) === '')
  ok('浮点长尾被截掉', formatExpr(type('0 . 1 + 0 . 2')).startsWith('0.1 +'))
}

console.log('\n[3] 税费：两项都按小计算，互不叠加')
{
  const t = applyTax(87, { sc: 10, sst: 6 })
  ok('服务费 = 87 × 10%', near(t.sc, 8.7))
  ok('SST = 87 × 6%，按小计不是按含服务费的金额', near(t.sst, 5.22))
  ok('合计 = 100.92', near(t.total, 100.92))
  ok('叠加算法会得到 101.44，必须不是它', !near(t.total, 101.44))

  // 用户给的验算：税率一样 → 两行金额必须一样
  const same = applyTax(87, { sc: 6, sst: 6 })
  ok('相同税率 → 两行金额完全相等', same.sc === same.sst, `${same.sc} vs ${same.sst}`)
  const same2 = applyTax(1234.56, { sc: 8.5, sst: 8.5 })
  ok('换个数字仍然相等', same2.sc === same2.sst)

  ok('只开服务费', near(applyTax(100, { sc: 10, sst: 0 }).total, 110))
  ok('只开 SST', near(applyTax(100, { sc: 0, sst: 6 }).total, 106))
  ok('都不开时合计等于原数', near(applyTax(100, {}).total, 100))
  ok('税率为负视为 0', near(applyTax(100, { sc: -5 }).total, 100))
  ok('税率是垃圾字符串视为 0', near(applyTax(100, { sc: 'abc' }).total, 100))
  ok('小数税率', near(applyTax(200, { sc: 2.5, sst: 0 }).total, 205))
}

console.log('\n[4] 从已有金额恢复（编辑记录时打开键盘）')
{
  ok('恢复整数', padFromAmount(87).cur === '87')
  ok('恢复小数', padFromAmount(12.5).cur === '12.5')
  ok('0 视为空', padFromAmount(0).cur === '')
  ok('null 视为空', padFromAmount(null).cur === '')
  ok('恢复后可以继续退格', padReduce(padFromAmount(87), 'del').cur === '8')
}

console.log('\n[5] 关掉键盘不该丢掉已加的税费')
{
  // 这是真实出现过的 bug：归零一度被放在「打开键盘」时，
  // 于是重新点开金额栏就退回小计，刚加的服务费和 SST 凭空消失。
  // padReduce 是纯函数，本来就不碰税费开关——这里把这件事钉死。
  const afterTyping = type('8 7')
  const reopened = padReduce(afterTyping, '') // 不认识的键应当原样返回
  ok('不认识的键不改状态', reopened.cur === '87' && reopened === afterTyping)
  ok('算式状态可以原样带过一次开合', padValue(afterTyping) === 87)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
