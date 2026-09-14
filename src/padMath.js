/**
 * 数字键盘的算术内核。
 *
 * 刻意做成纯函数：键盘组件只负责画按钮和转发按键，所有会算错钱的逻辑都在这里，
 * 可以脱离浏览器直接测。
 */

export const OPS = ['+', '−', '×', '÷']

export const EMPTY_PAD = {
  cur: '', // 正在输入的这一段
  prev: null, // 已经算出来的左值
  op: null, // 待执行的运算符
}

/**
 * 服务费和 SST 各自独立地按小计算，互不叠加。
 *
 * 这一条来自用户手里真实的马来西亚餐厅账单。它自带一个验算：
 * 两个税率填成一样时，两行金额必须一模一样——padMath 的测试就盯着这个不变量，
 * 以后谁再手滑改成「SST 按含服务费的金额算」，测试会立刻红。
 */
export function applyTax(base, rates = {}) {
  const b = Number(base) || 0
  const sc = b * (pct(rates.sc) / 100)
  const sst = b * (pct(rates.sst) / 100)
  return { base: b, sc, sst, total: b + sc + sst }
}

function pct(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 当前算式的值。除零返回 null——绝不放 Infinity 进金额。 */
export function padValue(s) {
  const cur = s.cur === '' || s.cur === '.' ? null : Number(s.cur)
  if (s.op === null) return Number.isFinite(cur) ? cur : null
  if (cur === null) return s.prev
  if (s.op === '÷' && cur === 0) return null
  if (s.op === '+') return s.prev + cur
  if (s.op === '−') return s.prev - cur
  if (s.op === '×') return s.prev * cur
  return s.prev / cur
}

/** 金额最多两位小数；整数位留 9 位，记账用不到更大的数 */
function clampAmount(str) {
  const m = String(str).match(/^(\d{0,9})(\.\d{0,2})?/)
  return m ? m[0] : str
}

/**
 * 按一个键，返回新状态。不认识的键原样返回，调用方不用先做判断。
 * 「完成」不在这里处理——它是组件的事（提交并收起），不改算式。
 */
export function padReduce(s, key) {
  if (key === 'del') {
    if (s.cur !== '') return { ...s, cur: s.cur.slice(0, -1) }
    // 已经没有右值可删时，退回到上一步：把运算符撤掉，左值放回输入区
    if (s.op !== null) return { cur: s.prev === null ? '' : String(s.prev), prev: null, op: null }
    return s
  }

  if (key === '.') {
    if (s.cur.includes('.')) return s
    return { ...s, cur: s.cur === '' ? '0.' : s.cur + '.' }
  }

  if (key === '00') {
    // 开头直接按 00 没有意义，忽略
    return s.cur === '' ? s : { ...s, cur: clampAmount(s.cur + '00') }
  }

  if (/^[0-9]$/.test(key)) {
    // 前导 0 只保留一个：0 再按 5 应该是 5，不是 05
    const next = s.cur === '0' ? key : s.cur + key
    return { ...s, cur: clampAmount(next) }
  }

  if (OPS.includes(key)) {
    // 先把前面的算完，这样 1+2+3 能连着按
    const v = padValue(s)
    if (v === null || !Number.isFinite(v)) return s
    return { cur: '', prev: v, op: key }
  }

  return s
}

/** 顶部那行算式。没在算的时候返回空串，不占视线。 */
export function formatExpr(s) {
  if (s.op === null) return ''
  return `${trim(s.prev)} ${s.op}${s.cur ? ' ' + s.cur : ''}`
}

function trim(n) {
  if (n === null) return ''
  // 去掉浮点运算带出来的长尾：0.1+0.2 不该显示成 0.30000000000000004
  return String(Math.round(Number(n) * 1e6) / 1e6)
}

/** 从一个已有金额恢复键盘状态，供「编辑记录」时打开键盘用 */
export function padFromAmount(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return { ...EMPTY_PAD }
  return { ...EMPTY_PAD, cur: clampAmount(String(n)) }
}
