/**
 * 收据截图解析。
 *
 * 输入是一段文字（来自 iOS 实况文本的粘贴，或本机 OCR 的输出），
 * 输出是一笔待确认的流水。纯函数，不碰 DOM、不碰数据库、不联网。
 *
 * 这个模块最容易出错也最要命的地方是**挑金额**。一张收据上少说有三四个数字：
 * 付款金额、手续费、钱包余额、参考号。挑错一个，账本就记了一笔假账，
 * 而且是那种你一个月后完全对不上、又想不起来为什么的假账。
 *
 * 所以这里的原则是：
 *   1. 优先认「标签旁边」的数字（Amount / Jumlah / Total），而不是最大的数字
 *   2. 余额、手续费所在的行直接排除，它们长得最像正确答案
 *   3. 把「这个数字是从哪一行认出来的」一起返回，让界面能把依据摆出来
 *   4. 认不出就返回 null 并说明，绝不编一个看起来合理的数
 */

import { guessCategory, stripIds } from './merchants.js'

/** 支持的来源。顺序就是界面上的顺序。 */
export const ISSUERS = [
  {
    id: 'tng',
    name: "Touch 'n Go eWallet",
    icon: '📱',
    hint: /touch\s*'?\s*n\s*go|tngd?\b|ewallet|go\+/i,
  },
  { id: 'maybank', name: 'Maybank', icon: '🏦', hint: /maybank|m2u\b|maybank2u/i },
  { id: 'cimb', name: 'CIMB', icon: '🏦', hint: /\bcimb\b|octo\s*app/i },
  { id: 'publicbank', name: 'Public Bank', icon: '🏦', hint: /public\s*bank|\bpbe\b|pbebank/i },
  { id: 'other', name: '其他银行 / 钱包', icon: '🧾', hint: null },
]

/* ---------------- 金额 ---------------- */

// 小数部分可有可无：「RM 50」是完全正常的收据金额。
// 但没有 RM 标记又没有小数的裸数字不算候选，否则日期、时间、参考号全会混进来。
const MONEY = /(RM|MYR)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d{1,7}(?:\.\d{2})?)\s*(RM|MYR)?/gi

// 手续费、积分、汇率：永远不是你要记的那笔钱，有没有标签都排除
const FEE_WORDS = /fee|charge|caj|yuran|rate|limit|points|mata|reward|cashback\s*earn/i

// 余额是最凶的陷阱：它和付款金额长得一模一样，而且通常更大。
// 除非这一行自己写着 Amount，否则一律排除。
//
// 这里只认「balance / baki / available」这几个词，**不能**认光秃秃的 wallet：
// TnG 收据的标题就是「Touch 'n Go eWallet」，而大字金额常常紧挨在它下一行。
// 把 wallet 当成余额信号的话，整张收据最重要的那个数字会被直接排除掉，
// 结果就是「认不出金额」。这个 bug 真实发生过，别再加回去。
const BALANCE_WORDS = /balance|baki|available|saldo|akaun\s*semasa/i

// 「Payment Method: eWallet Balance」里的 Balance 说的是付款方式，不是余额。
// 真实 TnG 收据上就有这一行，不排除掉的话，紧跟其后的金额会被误伤。
const NOT_REALLY_BALANCE = /payment\s*method|kaedah\s*bayaran|paid\s*(?:with|using|by)/i

// 越靠前优先级越高
const AMOUNT_LABELS = [
  /\b(?:transaction\s*amount|amount\s*paid|total\s*amount|jumlah\s*bayaran)\b/i,
  /\b(?:amount|jumlah|total|amaun|bayaran)\b/i,
  /金额|总额|付款/,
]

/**
 * 修掉 OCR 常见的三种把金额弄坏的方式。只在找金额时用，
 * 不碰商户名——那里乱改字符只会把名字搞花。
 */
export function repairMoney(line) {
  return (
    String(line)
      // 「RM 12. 50」「12 .50」：小数点两边多出空格
      .replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3')
      // 逗号后面只跟两位数字。千分位后面一定是三位，所以这是被读错的小数点。
      .replace(/(\d),(\d{2})(?!\d)/g, '$1.$2')
      // RM 紧跟的那串里，O 几乎只可能是 0，l/I 几乎只可能是 1
      .replace(/\b(RM|MYR)\s*([0-9OolI][0-9OolI,. ]{0,11})/gi, (whole, cur, num) =>
        `${cur} ${num.replace(/[Oo]/g, '0').replace(/[lI]/g, '1')}`
      )
  )
}

/**
 * 从所有候选里挑出付款金额。
 * 返回 { value, line, labeled } 或 null。
 */
export function pickAmount(rawLines) {
  const cands = []
  const lines = rawLines.map(repairMoney)

  lines.forEach((line, i) => {
    MONEY.lastIndex = 0
    let m
    while ((m = MONEY.exec(line)) !== null) {
      const token = m[2]
      if (!token) continue
      // 零宽匹配会让 exec 原地打转
      if (m[0].trim() === '') {
        MONEY.lastIndex++
        continue
      }

      const marked = Boolean(m[1] || m[3])
      const hasCents = token.includes('.')
      const value = Number(token.replace(/,/g, ''))
      if (!Number.isFinite(value) || value <= 0) continue

      // 数字必须是完整的一段，不能是更长数字串里截出来的一截。
      // 少了这一条，参考号 20260915102311887 会被切出前 7 位当成金额。
      const before = line[m.index + m[0].indexOf(token) - 1] ?? ' '
      const after = line[m.index + m[0].indexOf(token) + token.length] ?? ' '
      if (/[\d.,:/-]/.test(before) || /[\d:/-]/.test(after)) continue

      // 没有 RM 标记、又没有小数的裸数字一律不算：
      // 日期、时间、张数、参考号全长这样，放进来只会添乱。
      if (!marked && !hasCents) continue

      // 没有 RM 标记、整数位又有 7 位以上的，多半是被误读的参考号
      const intDigits = token.split('.')[0].replace(/,/g, '').length
      if (!marked && intDigits >= 7) continue

      // 标签可能和数字同一行，也可能在上一行——收据几乎都是竖排的：
      //   Wallet Balance
      //   RM 238.75
      // 只看当前行的话，这个 238.75 会被当成付款金额，而它是余额。
      const context = `${lines[i - 1] ?? ''} ${line}`
      let rank = AMOUNT_LABELS.findIndex((re) => re.test(context))
      if (rank < 0) rank = AMOUNT_LABELS.length

      if (FEE_WORDS.test(context)) return
      // 明写着 Amount 的话，旁边那个 Balance 字样管不着它
      if (
        BALANCE_WORDS.test(context) &&
        !NOT_REALLY_BALANCE.test(context) &&
        rank === AMOUNT_LABELS.length
      )
        return

      cands.push({ value, line: line.trim(), marked, rank, i })
    }
  })

  if (cands.length === 0) return null

  cands.sort((a, b) => {
    // 先比标签优先级，再比有没有 RM 标记，最后才比金额大小
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.marked !== b.marked) return a.marked ? -1 : 1
    return b.value - a.value
  })

  const best = cands[0]
  return {
    value: best.value,
    line: best.line,
    labeled: best.rank < AMOUNT_LABELS.length,
    // 排除余额和手续费之后只剩这一个数——这不是猜，是没有别的可能。
    // TnG 那种把金额大字单摆一行、不写标签的版式全靠这一条。
    sole: cands.length === 1,
    // 有并列的候选时要告诉界面，让它提示「核对一下」
    rivals: cands.filter((c) => c !== best && c.rank === best.rank).map((c) => c.value),
  }
}

/* ---------------- 日期 ---------------- */

const MONTHS = {
  jan: 1, feb: 2, mac: 3, mar: 3, apr: 4, may: 5, mei: 5, jun: 6,
  jul: 7, aug: 8, ogo: 8, sep: 9, sept: 9, oct: 10, okt: 10,
  nov: 11, dec: 12, dis: 12,
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * 认日期。
 *
 * 马来西亚是 DD/MM/YYYY，美式是 MM/DD/YYYY，同一串 `03/09/2026`
 * 两边读出来差了半年。默认按大马，但第二个数大于 12 时只可能是美式，
 * 这时才反过来——靠事实纠正，而不是靠猜。
 */
export function pickDate(lines, today) {
  const text = lines.join('\n')

  const tryPush = (y, mo, d) => {
    if (!y || !mo || !d) return null
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const iso = `${y}-${pad(mo)}-${pad(d)}`
    // 收据不可能来自未来。出现了就是认错了，宁可不给也不给一个错的。
    if (today && iso > today) return null
    return iso
  }

  // 2026-09-15
  let m = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text)
  if (m) {
    const iso = tryPush(+m[1], +m[2], +m[3])
    if (iso) return { value: iso, raw: m[0] }
  }

  // 15 Sep 2026 / 15 September 2026
  m = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b/.exec(text)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]
    const iso = tryPush(+m[3], mo, +m[1])
    if (iso) return { value: iso, raw: m[0] }
  }

  // Sep 15, 2026
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/.exec(text)
  if (m) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()]
    const iso = tryPush(+m[3], mo, +m[2])
    if (iso) return { value: iso, raw: m[0] }
  }

  // 15/09/2026 或 15-09-2026
  m = /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/.exec(text)
  if (m) {
    let d = +m[1]
    let mo = +m[2]
    // 第二个数超过 12，只可能是 MM/DD——这是事实，不是偏好
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]
    const iso = tryPush(+m[3], mo, d)
    if (iso) return { value: iso, raw: m[0], ambiguous: d <= 12 && mo <= 12 }
  }

  return null
}

/* ---------------- 方向与商户 ---------------- */

const INCOME_HINT =
  /\breceived\b|received\s*from|terima|diterima|credited|kredit|refund|reversal|cashback|masuk/i
const EXPENSE_HINT =
  /\bpaid\b|payment|successful\s*payment|sent|transferred\s*to|transfer\s*to|debited|debit|bayaran|dibayar|keluar/i

export function pickDirection(lines) {
  const text = lines.join(' ')
  // 支出的说法更明确，先看它；两边都命中时以支出为准，
  // 因为「Payment received by merchant」这种句子里两个词会同时出现
  if (EXPENSE_HINT.test(text)) return 'expense'
  if (INCOME_HINT.test(text)) return 'income'
  return 'expense'
}

const PARTY_LABELS =
  /^(?:paid\s*to|pay\s*to|to|kepada|penerima|recipient|beneficiary|merchant|peniaga|received\s*from|from|daripada|transfer\s*to)\b\s*[:：]?\s*(.*)$/i

// 一看就不是商户名的行
const NOISE =
  /^(?:successful|berjaya|transaction|receipt|resit|reference|rujukan|date|tarikh|time|masa|status|amount|jumlah|total|share|done|close|copy|save|balance|baki)\b/i

/**
 * 认商户 / 对方名字。认不出返回空串——
 * 空备注比一句从收据上抄错的话好，后者会让你以为自己当时记过。
 */
export function pickMerchant(lines) {
  // 先找带标签的
  for (const line of lines) {
    const m = PARTY_LABELS.exec(line.trim())
    if (m && m[1]) {
      const v = stripIds(m[1])
      if (v && v.length >= 2 && !NOISE.test(v)) return v
    }
  }
  // 标签单独占一行、名字在下一行的竖排版式
  for (let i = 0; i < lines.length - 1; i++) {
    const m = PARTY_LABELS.exec(lines[i].trim())
    if (m && !m[1]) {
      const v = stripIds(lines[i + 1])
      if (v && v.length >= 2 && !NOISE.test(v)) return v
    }
  }
  return ''
}

/** 参考号只用来核对，不写进记录（它可能夹带账号片段） */
const REF_LABEL = /(?:reference|ref(?:erence)?\s*(?:no|id)?|rujukan|transaction\s*id)\b/i

export function pickReference(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!REF_LABEL.test(lines[i])) continue
    // 同一行
    const same = /[:：.\s]\s*([A-Za-z0-9-]{6,})\s*$/.exec(lines[i].replace(REF_LABEL, ''))
    if (same) return same[1]
    // 竖排：标签一行，号码在下一行
    const next = /^([A-Za-z0-9-]{6,})$/.exec((lines[i + 1] ?? '').trim())
    if (next) return next[1]
  }
  return ''
}

export function detectIssuer(text) {
  for (const it of ISSUERS) {
    if (it.hint && it.hint.test(text)) return it.id
  }
  return 'other'
}

/* ---------------- 对外入口 ---------------- */

/**
 * 把一段收据文字解析成一笔待确认的流水。
 *
 * @param text        OCR 或粘贴得到的原文
 * @param issuerId    用户选的来源；传 'auto' 就自己认
 * @param today       'YYYY-MM-DD'，用来挡掉「未来的收据」
 * @param learnedRules 用户教过的商户→分类规则
 */
export function parseReceipt(text, { issuerId = 'auto', today, learnedRules } = {}) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const warnings = []
  if (lines.length === 0) {
    return { ok: false, warnings: ['没有识别到任何文字。'], lines }
  }

  const detected = detectIssuer(lines.join('\n'))
  const issuer = issuerId === 'auto' ? detected : issuerId
  if (issuerId !== 'auto' && detected !== 'other' && detected !== issuerId) {
    const name = (id) => ISSUERS.find((i) => i.id === id)?.name ?? id
    warnings.push(`你选的是${name(issuerId)}，但这张收据看起来来自${name(detected)}。`)
  }

  const amount = pickAmount(lines)
  const date = pickDate(lines, today)
  const direction = pickDirection(lines)
  const merchant = pickMerchant(lines)
  const reference = pickReference(lines)

  if (!amount) warnings.push('没认出金额，请手动填。')
  else if (!amount.labeled && !amount.sole) {
    warnings.push('金额旁边没有「Amount / Jumlah」这类标签，是按最像的那个挑的，请核对。')
  }
  if (amount?.rivals?.length) {
    warnings.push(`这张收据上还有别的金额（${amount.rivals.join('、')}），确认一下挑对了没有。`)
  }
  if (!date) warnings.push('没认出日期，默认用今天。')
  else if (date.ambiguous) {
    warnings.push(`日期 ${date.raw} 按大马习惯读成了 ${date.value}（日/月/年）。`)
  }
  if (!merchant) warnings.push('没认出商户名，备注留空了。')

  // 金额和日期都拿到才算「大致可信」。少一个就得人来补，
  // 这时候把信心说成高只会让人放松检查。
  const confidence = !amount ? 'low' : (amount.labeled || amount.sole) && date ? 'high' : 'medium'

  return {
    ok: Boolean(amount),
    issuer,
    detected,
    amount: amount?.value ?? null,
    amountLine: amount?.line ?? '',
    date: date?.value ?? today ?? null,
    dateGuessed: !date,
    direction,
    note: merchant,
    categoryId: guessCategory(`${merchant} ${lines.join(' ')}`, learnedRules),
    // 只用于给人核对，不进记录
    reference,
    confidence,
    warnings,
    lines,
  }
}
