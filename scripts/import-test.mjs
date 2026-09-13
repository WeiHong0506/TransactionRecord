// 对账单导入的端到端测试。
//
//   npm run build && npx vite preview --port 4173 &
//   python3 scripts/make-sample-statement.py /tmp/tng-rot.pdf -  rotated
//   python3 scripts/make-sample-statement.py /tmp/tng-flat.pdf - flat
//   python3 scripts/make-sample-statement.py /tmp/tng-locked.pdf 880506015527 rotated
//   node scripts/import-test.mjs
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173/TransactionRecord/'
const ROT = process.env.ROT_PDF ?? '/tmp/claude-0/tng-rot.pdf'
const FLAT = process.env.FLAT_PDF ?? '/tmp/claude-0/tng-flat.pdf'
const LOCKED = process.env.LOCKED_PDF ?? '/tmp/claude-0/tng-locked.pdf'
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
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.summary')

async function openImport() {
  await page.click('.dock-tab:has-text("账号")')
  await page.click('.icon-btn[aria-label="设置"]')
  await page.click('.list-item:has-text("导入对账单")')
  await page.waitForSelector('.sheet')
}

async function summary() {
  return page.$$eval('.import-summary .n', (els) => els.map((e) => e.textContent.trim()))
}

async function rowData() {
  return page.$$eval('.imp-row', (els) =>
    els.map((el) => ({
      desc: el.querySelector('.imp-desc')?.textContent.trim(),
      meta: el.querySelector('.imp-meta')?.textContent.trim(),
      amt: el.querySelector('.imp-amt')?.textContent.trim(),
      checked: el.querySelector('input[type=checkbox]')?.checked,
      cat: el.querySelector('.imp-controls select:last-child')?.value,
    }))
  )
}

/* ───────── 1. 旋转页面 ───────── */
console.log('\n[1] 旋转页面的对账单（真实账单就是这样排版的）')
await openImport()
await page.setInputFiles('input[type=file][accept*="pdf"]', ROT)
await page.waitForSelector('.import-summary', { timeout: 40000 })
const n1 = await summary()
console.log(`  共 ${n1[0]} · 导入 ${n1[1]} · 排除 ${n1[2]} · 重复 ${n1[3]}`)
check('解析出 17 条记录（横排表格被正确转正）', n1[0] === '17', `实际 ${n1[0]}`)
check('默认勾选 5 笔真实消费', n1[1] === '5', `实际 ${n1[1]}`)

const rows = await rowData()
rows.forEach((r, i) =>
  console.log(`  ${String(i + 1).padStart(2)}. ${r.checked ? '☑' : '☐'} ${r.desc} ${r.amt} [${r.cat || '-'}]`)
)
const by = (s) => rows.find((r) => r.desc?.includes(s) || r.meta?.includes(s))

check('折行的描述被合并', Boolean(by('Quick Reload Payment (via GO+ Balance)')))
check('折行的类型 DUITNOW_RECEI VEFROM 被识别并排除', by('DUITNOW_RECEI')?.checked === false)
check('充值未勾选', by('Quick Reload')?.checked === false)
check('钱包间转账未勾选', by('Fund Transfer')?.checked === false)
check('转入 GO+ 未勾选', by('eWallet Cash Out')?.checked === false)
check('GO+ 转入未勾选', by('GO+ Cash In')?.checked === false)
check('GO+ 每日利息默认不导入', by('GO+ Daily Earnings')?.checked === false)
check('DuitNow QR 扫码消费已勾选', by('Mixue')?.checked === true)
check('Payment 类型记为支出并勾选', by("McDonald's")?.checked === true)
check('Mixue 归类到餐饮', by('Mixue')?.cat === 'exp-food', by('Mixue')?.cat)
check('CALTEX 归类到交通', by('CALTEX')?.cat === 'exp-transport', by('CALTEX')?.cat)
check('99 Speedmart 归类到日用', by('99 Speedmart')?.cat === 'exp-daily', by('99 Speedmart')?.cat)
check("McDonald's 归类到餐饮", by("McDonald's")?.cat === 'exp-food', by("McDonald's")?.cat)
check('页脚没有被当成记录', !rows.some((r) => r.desc?.includes('system generated')))

// Reference / Details 两列全是十几二十位的流水号，绝不能混进备注里
const LONG_ID = /(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8,}/
const leaky = rows.filter((r) => LONG_ID.test(r.desc || '') || LONG_ID.test(r.meta || ''))
check(
  '备注和类型里没有流水号',
  leaky.length === 0,
  leaky.map((r) => r.desc).join(' / ')
)

await page.evaluate(() => document.querySelector('.sheet').scrollTo(0, 0))
await page.screenshot({ path: `${SHOTS}/20-import-preview.png` })

/* ───────── 2. 非旋转页面结果应完全一致 ───────── */
console.log('\n[2] 同样内容的非旋转版本，结果必须一致')
await page.click('.sheet-head .link')
await page.waitForSelector('input[type=file][accept*="pdf"]', { state: 'attached' })
await page.setInputFiles('input[type=file][accept*="pdf"]', FLAT)
await page.waitForSelector('.import-summary', { timeout: 40000 })
const n2 = await summary()
check('旋转与非旋转解析结果一致', n1.join() === n2.join(), `${n1.join('/')} vs ${n2.join('/')}`)

/* ───────── 3. 加密 PDF ───────── */
console.log('\n[3] 加密 PDF')
await page.click('.sheet-head .link')
await page.waitForSelector('input[type=file][accept*="pdf"]', { state: 'attached' })
await page.setInputFiles('input[type=file][accept*="pdf"]', LOCKED)
await page.waitForSelector('#pdf-pwd', { timeout: 40000 })
check('提示输入密码，而不是报解析失败', true)
await page.fill('#pdf-pwd', 'wrong')
await page.click('.sheet form .btn:not(.secondary)')
await page.waitForSelector('.note-box:has-text("密码不正确")', { timeout: 40000 })
check('密码错误时给出明确提示', true)
await page.screenshot({ path: `${SHOTS}/24-password-wrong.png` })
await page.fill('#pdf-pwd', LOCKED_PWD)
await page.click('.sheet form .btn:not(.secondary)')
await page.waitForSelector('.import-summary', { timeout: 40000 })
const n3 = await summary()
check('正确密码解锁后结果一致', n3.join() === n1.join(), `${n3.join('/')}`)

/* ───────── 4. 导入并去重 ───────── */
console.log('\n[4] 执行导入')
// 没被自动归类的（商户不在词库里）手动选一个，否则导入按钮是禁用的
const selects = await page.$$('.imp-controls select:last-child')
for (const s of selects) {
  if (!(await s.inputValue())) await s.selectOption('exp-other')
}
await page.click('.sheet > .btn:not(.secondary)')
await page.waitForTimeout(1500)

await page.click('.dock-tab:has-text("统计")')
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
const notes = await page.$$eval('.row .note', (els) => els.map((e) => e.textContent.trim()))
check(
  '导入后的备注里没有流水号',
  !notes.some((n) => /(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8,}/.test(n)),
  notes.join(' / ')
)
check('8 月导入了 4 笔（9 月那笔在另一个月）', imported.length === 4, `实际 ${imported.length}`)

console.log('\n[5] 重复导入会被识别')
await openImport()
await page.setInputFiles('input[type=file][accept*="pdf"]', ROT)
await page.waitForSelector('.import-summary', { timeout: 40000 })
const n4 = await summary()
console.log(`  共 ${n4[0]} · 导入 ${n4[1]} · 排除 ${n4[2]} · 重复 ${n4[3]}`)
check('5 笔被标记为重复', n4[3] === '5', `实际 ${n4[3]}`)
check('重复的不会再被勾选', n4[1] === '0', `实际 ${n4[1]}`)
await page.screenshot({ path: `${SHOTS}/21-import-dedup.png` })

if (errors.length) {
  console.log('\n⚠ 控制台报错：')
  errors.forEach((e) => console.log('  ' + e))
}
console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
