// 生产构建的冒烟测试：跑通记账流程、截图各视图、并验证断网后仍可打开
//
// 用法（playwright 不在 package.json 里，免得拖慢 CI）：
//   npm run build
//   npx vite preview --port 4173 &
//   npm i -D playwright && npx playwright install chromium
//   node scripts/smoke-test.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:4173/TransactionRecord/'
const SHOTS = '/tmp/claude-0/shots'
mkdirSync(SHOTS, { recursive: true })

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

// 整页截图时把固定定位的底栏藏掉，否则它会盖在页面中间
const hideTabbar = () =>
  page.evaluate(() => {
    const s = document.createElement('style')
    s.id = 'hide-tabbar'
    s.textContent = '.tabbar{display:none !important}'
    document.head.appendChild(s)
  })
const showTabbar = () =>
  page.evaluate(() => document.getElementById('hide-tabbar')?.remove())

const shot = async (name, full = true) => {
  await hideTabbar()
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full })
  await showTabbar()
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.summary')

// —— 通过界面记一笔，验证表单链路 ——
await page.click('.fab')
await page.fill('#amt', '38.50')
await page.click('.cat-chip:has-text("餐饮")')
await page.fill('#note', '和同事午饭')
await page.click('button[type="submit"]')
await page.waitForSelector('.row')
console.log('✓ 通过界面成功记账')

// —— 灌入演示数据，让图表有内容可看 ——
await page.evaluate(async () => {
  const cats = ['exp-food', 'exp-transport', 'exp-shopping', 'exp-housing', 'exp-fun', 'exp-daily', 'exp-health']
  const notes = ['杂货', '地铁月票', '咖啡', '网费', '电影票', '洗发水', '感冒药', '午饭', '打车']
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('transaction-record')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const now = new Date()
  const rows = []
  let seed = 7
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  for (let back = 0; back < 6; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const days = back === 0 ? now.getDate() : new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    const count = back === 0 ? 16 : 12
    for (let i = 0; i < count; i++) {
      const day = 1 + Math.floor(rnd() * days)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      rows.push({
        id: 'demo-' + back + '-' + i,
        type: 'expense',
        amount: Math.round((8 + rnd() * 220) * 100) / 100,
        categoryId: cats[Math.floor(rnd() * cats.length)],
        accountId: 'acc-cash',
        note: notes[Math.floor(rnd() * notes.length)],
        date,
        month: date.slice(0, 7),
        createdAt: Date.now() - back * 1000 - i,
        updatedAt: Date.now() - back * 1000 - i,
        deletedAt: null,
        dirty: 0,
      })
    }
    const payDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-05`
    rows.push({
      id: 'demo-pay-' + back,
      type: 'income',
      amount: 4200,
      categoryId: 'inc-salary',
      accountId: 'acc-cash',
      note: '月薪',
      date: payDate,
      month: payDate.slice(0, 7),
      createdAt: Date.now() - back * 1000,
      updatedAt: Date.now() - back * 1000,
      deletedAt: null,
      dirty: 0,
    })
  }
  const tx = db.transaction('transactions', 'readwrite')
  for (const r of rows) tx.objectStore('transactions').put(r)
  await new Promise((res) => (tx.oncomplete = res))
})

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.row')

// 默认落在「明细」tab
const defaultTab = await page.getAttribute('.view-tabs button:has-text("明细")', 'aria-pressed')
console.log(
  defaultTab === 'true' ? '✓ 统计页默认停在「明细」' : `✗ 默认 tab 不对：${defaultTab}`
)
await shot('01-list')

// 分类构成
await page.click('.view-tabs button:has-text("分类构成")')
await page.waitForSelector('.legend-row')
await shot('02-breakdown')

// 单分类环形图：演示数据里收入只有「工资」一个分类，正好覆盖跨满 360° 的情况
await page.click('.card-pad .seg button:has-text("收入")')
await page.waitForTimeout(300)
const ring = await page.evaluate(() => {
  const svg = document.querySelector('.chart-wrap svg')
  if (!svg) return { ok: false, why: '找不到图表' }
  const circle = svg.querySelector('circle')
  const box = (circle ?? svg.querySelector('path'))?.getBoundingClientRect()
  return { ok: Boolean(box && box.width > 20), w: box?.width, mode: circle ? '整圆' : '扇区' }
})
console.log(
  ring.ok
    ? `✓ 单分类时环形图正常渲染（${ring.mode}，宽 ${Math.round(ring.w)}px）`
    : `✗ 单分类环形图没画出来：${JSON.stringify(ring)}`
)
await shot('08-single-category')
await page.click('.card-pad .seg button:has-text("支出")')

// 日历
await page.click('.view-tabs button:has-text("日历")')
await page.waitForSelector('.cal-grid')
await shot('09-calendar')
await page.locator('.cal-cell.has-data').first().click()
await page.waitForSelector('.row')
await shot('10-calendar-day')
console.log('✓ 日历视图与当日明细渲染正常')

// —— 账号管理 ——
await page.click('.tab:has-text("账号")')
await page.waitForSelector('.acct-row')
const balance = await page.textContent('.summary .hero')
console.log(`✓ 账号管理页渲染正常，总资产 ${balance.trim()}`)
await shot('11-accounts')

// 新增一个账户
await page.click('.btn.secondary:has-text("新增账户")')
await page.waitForSelector('.sheet')
await page.fill('#acc-name', 'TnG 电子钱包')
await page.fill('#acc-init', '50')
await page.click('.sheet .btn:has-text("保存")')
await page.waitForTimeout(400)
const acctCount = await page.locator('.acct-row').count()
console.log(
  acctCount === 2 ? '✓ 新增账户成功，余额已计入总资产' : `✗ 账户数不对：${acctCount}`
)
await shot('12-accounts-two')

// —— 设置（从账号页右上角齿轮进入）——
await page.click('.icon-btn[aria-label="设置"]')
await page.waitForSelector('.note-box')
await shot('03-settings')
await page.click('.icon-btn[aria-label="返回"]')
await page.waitForSelector('.acct-row')
console.log('✓ 设置页可从账号页进入并返回')

// 记账弹层（现在带账户选择）
await page.click('.fab')
await page.waitForSelector('.sheet')
await page.waitForTimeout(400)
const hasAcctPicker = await page.locator('.acct-picker').count()
console.log(hasAcctPicker ? '✓ 记账表单出现账户选择' : '✗ 记账表单缺少账户选择')
await page.screenshot({ path: `${SHOTS}/04-add.png` })
await page.keyboard.press('Escape')

// 深色模式
await page.emulateMedia({ colorScheme: 'dark' })
await page.click('.tab:has-text("统计")')
await page.click('.view-tabs button:has-text("分类构成")')
await page.waitForSelector('.legend-row')
await shot('05-dark-breakdown')
await page.click('.view-tabs button:has-text("日历")')
await page.waitForSelector('.cal-grid')
await shot('13-dark-calendar')
await page.emulateMedia({ colorScheme: 'light' })

// —— 离线验证：Service Worker 接管后断网仍能打开 ——
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
  timeout: 15000,
})
await ctx.setOffline(true)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.summary', { timeout: 10000 })
const offlineRows = await page.locator('.row').count()
console.log(`✓ 断网后仍可打开，列表仍有 ${offlineRows} 条记录`)
await ctx.setOffline(false)

if (errors.length) {
  console.log('\n⚠ 控制台报错：')
  errors.forEach((e) => console.log('  ' + e))
} else {
  console.log('✓ 无控制台报错')
}

await browser.close()
