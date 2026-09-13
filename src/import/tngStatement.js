import { extractTable } from './pdfTable.js'

/**
 * Touch 'n Go eWallet 对账单解析。
 *
 * 表头形如：Date | Status | Transaction Type | Description | Amount (RM) | Wallet Balance
 */

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const DATE_SEARCH_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/
const AMOUNT_RE = /-?RM\s*([\d,]+\.?\d*)/i

const headerMatch = (line) =>
  /transaction\s*type/i.test(line) && /amount/i.test(line)

const isRecordStart = (cells) => DATE_RE.test((cells[0] ?? '').trim())

// 折行续写的特征是日期列为空。页脚的「Total Debit: ...」通常顶格写，
// 会落进日期列，据此把它挡在外面。
const isContinuation = (cells) => !(cells[0] ?? '').trim()

// 马来西亚这边日期是 DD/MM/YYYY，不是美式的 MM/DD
function parseDate(s) {
  const m = DATE_SEARCH_RE.exec(String(s).trim())
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${String(Number(mo)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`
}

function parseAmount(s) {
  const m = AMOUNT_RE.exec(String(s))
  if (!m) return null
  const v = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(v) ? v : null
}

/**
 * 交易类型规则。
 *
 * 注意 DuitNow 有两副面孔：`DuitNow QR` 是扫码消费（要记），
 * `DUITNOW_RECEIVEFROM` 是别人转账给你（不记）。按 "duitnow" 一刀切
 * 会把钱包里占比最大的那部分支出悄悄丢掉。
 */
const TYPE_RULES = [
  { re: /duitnow[\s_-]*receive/i, action: 'exclude', why: '收到他人转账' },
  { re: /duitnow[\s_-]*(qr|pay|send|transfer\s*to)/i, action: 'expense', why: '扫码消费' },
  { re: /^reload|top[\s-]*up/i, action: 'exclude', why: '钱包充值，属于转账' },
  { re: /transfer\s*to\s*wallet|fund\s*transfer/i, action: 'exclude', why: '钱包间转移' },
  { re: /refund|reversal/i, action: 'income', why: '退款' },
  { re: /cashback|reward/i, action: 'income', why: '返现' },
]

function classify(type) {
  for (const r of TYPE_RULES) {
    if (r.re.test(type)) return r
  }
  return { action: 'unknown', why: '未知类型，请确认' }
}

// 马来西亚常见商户 → 分类。命中靠的是描述里的商户名。
const MERCHANT_RULES = [
  ['exp-food', /mixue|mcdonald|kfc|starbucks|zus|tealive|chagee|foodpanda|grabfood|restoran|kopitiam|cafe|bakery|secret recipe|oldtown|texas chicken|subway|domino|pizza/i],
  ['exp-transport', /grab(?!food)|rapid|mrt|lrt|ktm|shell|petronas|petron|caltex|bhp|parking|smart\s*tag|plus\s|touch.?n.?go|toll|myrapid|airasia|ets/i],
  ['exp-shopping', /shopee|lazada|mydin|aeon|tesco|lotus|giant|econsave|uniqlo|padini|decathlon|ikea|nsk/i],
  ['exp-daily', /7[\s-]*eleven|kk\s*super|familymart|99\s*speed|watson|guardian|caring|speedmart|mr\.?\s*diy/i],
  ['exp-fun', /gsc|tgv|mbo|cinema|netflix|spotify|steam|playstation|karaoke|golf|gym/i],
  ['exp-health', /clinic|klinik|pharmacy|farmasi|hospital|dental|dentist|medical/i],
  ['exp-housing', /tnb|syabas|air\s*selangor|indah\s*water|unifi|maxis|celcom|digi|umobile|astro|time\s*fibre|yes\s*4g/i],
  ['exp-edu', /tuition|academy|udemy|coursera|bookstore|popular\b|mph\b/i],
]

function guessCategory(description, learned) {
  const text = String(description || '')
  // 用户自己教过的规则优先——它比内置列表更懂你的消费
  for (const [kw, catId] of Object.entries(learned || {})) {
    if (kw && text.toLowerCase().includes(kw.toLowerCase())) return catId
  }
  for (const [catId, re] of MERCHANT_RULES) {
    if (re.test(text)) return catId
  }
  return null
}

/** 同一笔记录的指纹，用来防止同一个文件导两次 */
export function fingerprint(date, amount, note) {
  return `${date}|${Number(amount).toFixed(2)}|${String(note || '').trim().toLowerCase()}`
}

/**
 * 解析对账单。
 * @returns { rows, rawLines, columns, warnings }
 *   rows 每项：{ date, type(交易类型原文), description, amount, balance,
 *               action, why, direction, categoryId, include, dup }
 */
export async function parseTngStatement(file, { learnedRules, existingFingerprints } = {}) {
  const { columns, rows: raw, rawLines, ignored } = await extractTable(file, {
    headerMatch,
    isRecordStart,
    isContinuation,
  })

  const warnings = []
  for (const line of ignored ?? []) {
    warnings.push(`忽略非记录行：${line.slice(0, 70)}`)
  }
  if (!columns) {
    warnings.push('没能在 PDF 里找到表头，可能不是 TnG 对账单，或者是扫描件（图片版 PDF）。')
    return { rows: [], rawLines, columns, warnings }
  }

  // 按列名定位，不依赖固定下标——万一 TnG 调整了列顺序也不至于全错
  const idxOf = (re, fallback) => {
    const i = columns.findIndex((c) => re.test(c))
    return i >= 0 ? i : fallback
  }
  const iDate = idxOf(/date/i, 0)
  const iType = idxOf(/transaction\s*type/i, 2)
  const iDesc = idxOf(/description/i, 3)
  const iAmount = idxOf(/amount/i, 4)
  const iBalance = idxOf(/balance/i, 5)

  const rows = []
  let prevBalance = null

  for (const cells of raw) {
    const date = parseDate(cells[iDate] ?? '')
    const amount = parseAmount(cells[iAmount] ?? '')
    if (!date || amount == null) {
      warnings.push(`跳过无法解析的一行：${cells.join(' | ').slice(0, 80)}`)
      continue
    }

    const type = (cells[iType] ?? '').trim()
    const description = (cells[iDesc] ?? '').trim()
    const balance = parseAmount(cells[iBalance] ?? '')

    // 方向优先看余额变化——比按类型名猜可靠得多
    let direction = null
    if (balance != null && prevBalance != null) {
      const delta = balance - prevBalance
      if (Math.abs(Math.abs(delta) - amount) < 0.011) {
        direction = delta < 0 ? 'expense' : 'income'
      }
    }
    if (balance != null) prevBalance = balance

    const rule = classify(type)
    const resolved =
      rule.action === 'expense' || rule.action === 'income'
        ? rule.action
        : direction ?? 'expense'

    const note = description || type
    const fp = fingerprint(date, amount, note)

    rows.push({
      date,
      type,
      description,
      amount,
      balance,
      why: rule.why,
      action: rule.action,
      direction: resolved,
      categoryId: guessCategory(`${type} ${description}`, learnedRules),
      // 规则说排除的默认不勾；未知类型默认勾上——漏记比多记更难发现
      include: rule.action !== 'exclude',
      dup: existingFingerprints?.has(fp) ?? false,
      fp,
    })
  }

  return { rows, rawLines, columns, warnings }
}
