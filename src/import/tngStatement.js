import { extractTable } from './pdfTable.js'
import { guessCategory, stripIds } from './merchants.js'

export { PdfPasswordError } from './pdfTable.js'

/**
 * Touch 'n Go eWallet 对账单解析。
 *
 * 真实账单的表头是：
 *   Date | Status | Transaction Type | Reference | Description | Details | Amount (RM) | Wallet Balance
 * 而且一份文件里通常有两张表：钱包流水，之后是 GO+ 理财流水（最后一列换成 GO+ Balance）。
 */

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const DATE_SEARCH_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/
const AMOUNT_RE = /-?RM\s*([\d,]+\.?\d*)/i

const headerMatch = (line) =>
  /transaction\s*type/i.test(line) && /amount/i.test(line) && /description/i.test(line)

const isRecordStart = (cells) => DATE_RE.test((cells[0] ?? '').trim())

// 折行续写的特征是日期列为空。每页页脚的「*This is a system generated email...」
// 顶格写、会落进日期列，据此把它挡在外面。
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
 * 交易类型规则。匹配前会把类型名去掉所有空格并转小写——
 * PDF 里长类型名经常被折行成 `DUITNOW_RECEI VEFROM`，带空格的原文匹配不上。
 *
 * 注意 DuitNow 有两副面孔：`DuitNow QR` 是扫码消费（要记），
 * `DUITNOW_RECEIVEFROM` 是别人转账给你（不记）。按 "duitnow" 一刀切
 * 会把钱包里占比最大的那部分支出悄悄丢掉。
 */
const TYPE_RULES = [
  { re: /duitnow_?receive/, action: 'exclude', why: '收到他人转账' },
  { re: /duitnow_?(qr|pay|send|transferto)/, action: 'expense', why: '扫码消费' },
  { re: /^reload|topup/, action: 'exclude', why: '钱包充值，属于转账' },
  { re: /transfertowallet|fundtransfer/, action: 'exclude', why: '钱包间转移' },
  // GO+ 是钱包内置的理财，进出都只是钱在自己名下挪动，不是收支
  { re: /ewalletcashout/, action: 'exclude', why: '转入 GO+，属于转账' },
  { re: /go\+?cashin/, action: 'exclude', why: 'GO+ 转入，属于转账' },
  {
    re: /go\+?dailyearnings/,
    action: 'income',
    include: false,
    why: 'GO+ 每日利息（金额极小，默认不导入）',
  },
  { re: /^payment$|^payment/, action: 'expense', why: '商户消费' },
  { re: /refund|reversal/, action: 'income', why: '退款' },
  { re: /cashback|reward/, action: 'income', why: '返现' },
]

function classify(type) {
  const norm = String(type).replace(/\s+/g, '').toLowerCase()
  for (const r of TYPE_RULES) {
    if (r.re.test(norm)) return r
  }
  return { action: 'unknown', why: '未知类型，请确认' }
}

/** 同一笔记录的指纹，用来防止同一个文件导两次 */
export function fingerprint(date, amount, note) {
  return `${date}|${Number(amount).toFixed(2)}|${String(note || '').trim().toLowerCase()}`
}

const idxOf = (columns, re, fallback) => {
  const i = columns.findIndex((c) => re.test(c))
  return i >= 0 ? i : fallback
}

export async function parseTngStatement(
  file,
  { learnedRules, existingFingerprints, password } = {}
) {
  const { rows: raw, rawLines, ignored, orientation, columns } = await extractTable(file, {
    headerMatch,
    isRecordStart,
    isContinuation,
    password,
  })

  const warnings = []
  if (!columns || !raw?.length) {
    warnings.push(
      '没能在 PDF 里认出交易表格。可能不是 TnG 对账单，或者是扫描件（图片版 PDF，里面没有文字层）。'
    )
    return { rows: [], rawLines, columns, warnings }
  }
  if (orientation && orientation !== '正常') {
    warnings.push(`页面是旋转的（${orientation}），已自动转正后解析。`)
  }

  // ── 先把每行拆成结构化字段 ──
  const parsed = []
  for (const { cells, columns: cols } of raw) {
    const date = parseDate(cells[idxOf(cols, /date/i, 0)] ?? '')
    const amount = parseAmount(cells[idxOf(cols, /amount/i, 6)] ?? '')
    if (!date || amount == null) {
      warnings.push(`跳过无法解析的一行：${cells.join(' | ').slice(0, 80)}`)
      continue
    }
    const balanceCol = idxOf(cols, /balance/i, -1)
    parsed.push({
      date,
      amount,
      type: stripIds(cells[idxOf(cols, /transaction\s*type/i, 2)]),
      description: stripIds(cells[idxOf(cols, /description/i, 4)]),
      balance: balanceCol >= 0 ? parseAmount(cells[balanceCol] ?? '') : null,
      // 一份文件里有多张表，余额不能跨表比较，用列名把它们分开
      ledger: balanceCol >= 0 ? cols[balanceCol] : 'default',
    })
  }

  // ── 统一成时间正序 ──
  // 余额差要按时间顺序比才有意义。对账单有的按正序有的按倒序，
  // 这里先归一化，避免方向判断整体反过来。
  if (parsed.length > 1 && parsed[0].date > parsed[parsed.length - 1].date) {
    parsed.reverse()
    warnings.push('账单是倒序排列的，已按时间正序重新排列。')
  }

  // ── 定方向、分类、去重 ──
  const prevBalance = new Map()
  const rows = []

  for (const p of parsed) {
    // 方向优先看余额变化——比按类型名猜可靠得多
    let direction = null
    const prev = prevBalance.get(p.ledger)
    if (p.balance != null && prev != null) {
      const delta = p.balance - prev
      if (Math.abs(Math.abs(delta) - p.amount) < 0.011) {
        direction = delta < 0 ? 'expense' : 'income'
      }
    }
    if (p.balance != null) prevBalance.set(p.ledger, p.balance)

    const rule = classify(p.type)
    const resolved =
      rule.action === 'expense' || rule.action === 'income'
        ? rule.action
        : direction ?? 'expense'

    const note = p.description || p.type
    const fp = fingerprint(p.date, p.amount, note)

    rows.push({
      ...p,
      why: rule.why,
      action: rule.action,
      direction: resolved,
      categoryId: guessCategory(`${p.type} ${p.description}`, learnedRules),
      // 规则说排除的默认不勾；未知类型默认勾上——漏记比多记更难发现
      include: rule.include ?? rule.action !== 'exclude',
      dup: existingFingerprints?.has(fp) ?? false,
      fp,
    })
  }

  for (const line of (ignored ?? []).slice(0, 20)) {
    warnings.push(`忽略非记录行：${line.slice(0, 70)}`)
  }

  return { rows, rawLines, columns, warnings, orientation }
}
