/**
 * 收据截图 OCR 的端到端测试。要开浏览器，跑生产构建。
 *
 * 用法：
 *   python3 scripts/make-sample-receipts.py
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ocr-test.mjs
 *
 * 验的是三件真实世界会碰上的事：
 *   1. 深色模式截图是「浅字深底」，不反色的话 Tesseract 几乎认不出来
 *   2. 被压缩过的低分辨率截图要先放大
 *   3. 同屏有付款金额、手续费、可用余额时，必须挑中付款金额
 *
 * 还有一件同样重要的：整个过程**不能有任何外部请求**。
 * 模型是自己托管的，一旦有请求发往 cdn.jsdelivr.net 就说明配漏了路径，
 * 那意味着挡了 CDN 的网络下这个功能会静默卡死。
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/TransactionRecord/'
const DIR = '/tmp/claude-0/receipts'

const CASES = [
  {
    label: '浅色模式截图',
    file: `${DIR}/tng-light.png`,
    issuer: 'Touch',
    want: { amount: '12.50', date: '2026-09-15', note: 'ZUS Coffee Mid Valley' },
  },
  {
    label: '深色模式截图（要反色）',
    file: `${DIR}/tng-dark.png`,
    issuer: 'Touch',
    want: { amount: '12.50', date: '2026-09-15', note: 'ZUS Coffee Mid Valley' },
  },
  {
    label: '低分辨率截图（要放大）',
    file: `${DIR}/tng-small.png`,
    issuer: 'Touch',
    want: { amount: '12.50', date: '2026-09-15', note: 'ZUS Coffee Mid Valley' },
  },
  {
    label: 'CIMB：同屏三个金额，要挑付款那个',
    file: `${DIR}/cimb.png`,
    issuer: 'CIMB',
    want: { amount: '1200.00', date: '2026-09-15', note: 'TAN AH KAU' },
  },
]

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
)
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })

// 任何发往站外的请求都是配置漏了路径
const external = []
page.on('request', (r) => {
  const u = r.url()
  if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u)
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.summary')

for (const c of CASES) {
  console.log(`\n[${c.label}]`)
  await page.click('.dock-tab:has-text("资产")')
  await page.waitForTimeout(250)
  await page.click('.icon-btn[aria-label="设置"]')
  await page.click('.list-item:has-text("导入收据截图")')
  await page.waitForSelector('.rcp')
  await page.click(`.list-item:has-text("${c.issuer}")`)
  await page.waitForSelector('.rcp-text')

  const t0 = Date.now()
  await page.setInputFiles('input[type=file][accept="image/*"]', c.file)
  try {
    await page.waitForSelector('.rcp-verdict', { timeout: 120000 })
  } catch {
    const err = await page.textContent('.note-box.warn').catch(() => '(界面上没有报错)')
    ok('识别完成', false, err)
    await page.click('.icon-btn[aria-label="关闭"]').catch(() => {})
    continue
  }
  const secs = (Date.now() - t0) / 1000

  const got = await page.evaluate(() => ({
    amount: document.querySelector('#rcp-amount')?.value,
    date: document.querySelector('#rcp-date')?.value,
    note: document.querySelector('#rcp-note')?.value,
    verdict: document.querySelector('.rcp-verdict')?.dataset.level,
  }))

  ok(`金额 ${c.want.amount}`, got.amount === c.want.amount, got.amount)
  ok(`日期 ${c.want.date}`, got.date === c.want.date, got.date)
  ok(`备注 ${c.want.note}`, got.note === c.want.note, got.note)
  // 慢到十几秒的话手机上就没人愿意用了
  ok(`识别耗时 ${secs.toFixed(1)}s 在可接受范围`, secs < 30, `${secs.toFixed(1)}s`)

  await page.click('.icon-btn[aria-label="关闭"]')
  await page.waitForTimeout(300)
}

console.log('\n[外部请求]')
ok('全程没有任何站外请求（模型是自己托管的）', external.length === 0, external.slice(0, 5).join(' '))

await browser.close()
console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
