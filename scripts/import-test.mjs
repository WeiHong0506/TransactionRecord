// 对账单导入的端到端测试。
// 用 scripts/make-sample-statement.py 生成的测试 PDF 跑完整流程。
//
//   npm run build && npx vite preview --port 4173 &
//   python3 scripts/make-sample-statement.py
//   node scripts/import-test.mjs
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173/TransactionRecord/'
const PDF = process.env.SAMPLE_PDF ?? '/tmp/claude-0/tng-sample.pdf'
const LOCKED_PDF = process.env.LOCKED_PDF ?? '/tmp/claude-0/tng-locked.pdf'
const LOCKED_PWD = process.env.LOCKED_PWD ?? '880506015527'
const SHOTS = '/tmp/claude-0/shots'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
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
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.summary')

// 账号 → 设置 → 导入对账单
await page.click('.tab:has-text("账号")')
await page.click('.icon-btn[aria-label="设置"]')
await page.click('.list-item:has-text("导入对账单")')
await page.waitForSelector('.sheet')

console.log('\n[0] 加密 PDF：应当提示输密码，而不是报解析失败')
await page.setInputFiles('input[type=file][accept*="pdf"]', LOCKED_PDF)
await page.waitForSelector('#pdf-pwd', { timeout: 30000 })
check('加密 PDF 弹出密码输入，而不是错误页', true)

await page.fill('#pdf-pwd', 'wrong-password')
await page.click('.sheet form .btn:not(.secondary)')
await page.waitForTimeout(1500)
const wrongShown = await page.locator('.note-box:has-text("密码不正确")').count()
check('密码错误时给出明确提示并停留在输入框', wrongShown === 1)

await page.fill('#pdf-pwd', LOCKED_PWD)
await page.click('.sheet form .btn:not(.secondary)')
await page.waitForSelector('.import-summary', { timeout: 30000 })
const lockedNums = await page.$$eval('.import-summary .n', (els) => els.map((e) => e.textContent.trim()))
check('正确密码解锁后照常解析出 8 条', lockedNums[0] === '8', `实际 ${lockedNums[0]}`)
await page.screenshot({ path: `${SHOTS}/22-import-password.png` })

// 换回不加密的文件，继续原有测试
await page.click('.sheet-head .link')
// 文件输入是隐藏的（由按钮触发），等 attached 而不是 visible
await page.waitForSelector('input[type=file][accept*="pdf"]', { state: 'attached' })

console.log('\n[1] 解析 PDF')
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.import-summary', { timeout: 30000 })

const nums = await page.$$eval('.import-summary .n', (els) => els.map((e) => e.textContent.trim()))
console.log(`  解析结果：共 ${nums[0]} · 导入 ${nums[1]} · 排除 ${nums[2]} · 重复 ${nums[3]}`)
check('共解析出 8 条记录（折行没有被当成独立记录）', nums[0] === '8', `实际 ${nums[0]}`)
check('默认勾选 4 笔（两次 Reload、一次钱包转账、一次收款被排除）', nums[1] === '4', `实际 ${nums[1]}`)
check('排除 4 笔', nums[2] === '4', `实际 ${nums[2]}`)

console.log('\n[2] 逐条判断')
const rows = await page.$$eval('.imp-row', (els) =>
  els.map((el) => ({
    desc: el.querySelector('.imp-desc')?.textContent.trim(),
    meta: el.querySelector('.imp-meta')?.textContent.trim(),
    amt: el.querySelector('.imp-amt')?.textContent.trim(),
    checked: el.querySelector('input[type=checkbox]')?.checked,
    cat: el.querySelector('.imp-controls select:last-child')?.value,
  }))
)
rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.checked ? '☑' : '☐'} ${r.desc} ${r.amt} [${r.cat ?? '-'}]`))

const byDesc = (s) => rows.find((r) => r.desc?.includes(s))
check('Reload 的折行描述被正确合并', Boolean(byDesc('Quick Reload Payment (via GO+ Balance)')), byDesc('Quick Reload')?.desc)
check('Reload 未勾选', byDesc('Quick Reload')?.checked === false)
check('钱包间转账未勾选', byDesc('Fund Transfer')?.checked === false)
check('收到他人转账未勾选', byDesc('TAN WEI HONG')?.checked === false)
check('DuitNow QR 扫码消费已勾选', byDesc('Mixue')?.checked === true)
check('Mixue 自动归类到餐饮', byDesc('Mixue')?.cat === 'exp-food', byDesc('Mixue')?.cat)
check('99 SPEEDMART 自动归类到日用', byDesc('99 SPEEDMART')?.cat === 'exp-daily', byDesc('99 SPEEDMART')?.cat)
check('SHELL 自动归类到交通', byDesc('SHELL')?.cat === 'exp-transport', byDesc('SHELL')?.cat)
check('未知类型 Payment 按余额变化判成支出并勾选', byDesc('GRABFOOD')?.checked === true)
check('GRABFOOD 自动归类到餐饮', byDesc('GRABFOOD')?.cat === 'exp-food', byDesc('GRABFOOD')?.cat)
check('支出金额显示为负号', byDesc('Mixue')?.amt?.startsWith('-'), byDesc('Mixue')?.amt)

await page.evaluate(() => document.querySelector('.sheet').scrollTo(0, 0))
await page.screenshot({ path: `${SHOTS}/20-import-preview.png` })

console.log('\n[3] 执行导入')
await page.click('.sheet .btn:not(.secondary)')
await page.waitForTimeout(1200)
await page.click('.tab:has-text("统计")')
// 账单是 8 月的，而应用默认停在当前月，要翻回去才看得到
const target = '2026-08'
for (let i = 0; i < 24; i++) {
  const label = await page.textContent('.month-switch .label')
  const [y, m] = label.match(/(\d{4})\D+(\d{1,2})/).slice(1)
  if (`${y}-${String(Number(m)).padStart(2, '0')}` === target) break
  await page.click('.month-switch button[aria-label="上个月"]')
  await page.waitForTimeout(80)
}
await page.waitForSelector('.row')
const imported = await page.$$eval('.row .name', (els) => els.map((e) => e.textContent.trim()))
console.log(`  8 月明细：${imported.join('、')}`)
check('导入的 4 笔出现在 8 月明细里', imported.length === 4, `实际 ${imported.length} 条`)

console.log('\n[4] 重复导入会被识别')
await page.click('.tab:has-text("账号")')
await page.click('.icon-btn[aria-label="设置"]')
await page.click('.list-item:has-text("导入对账单")')
await page.waitForSelector('.sheet')
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.import-summary', { timeout: 30000 })
const nums2 = await page.$$eval('.import-summary .n', (els) => els.map((e) => e.textContent.trim()))
console.log(`  再次解析：共 ${nums2[0]} · 导入 ${nums2[1]} · 排除 ${nums2[2]} · 重复 ${nums2[3]}`)
check('同一个文件再导一次，4 笔被标记为重复', nums2[3] === '4', `实际 ${nums2[3]}`)
check('重复的不会再被勾选导入', nums2[1] === '0', `实际 ${nums2[1]}`)
await page.screenshot({ path: `${SHOTS}/21-import-dedup.png` })

if (errors.length) {
  console.log('\n⚠ 控制台报错：')
  errors.forEach((e) => console.log('  ' + e))
}
console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
