// 生产构建的冒烟测试：跑通记账流程、截图、并验证断网后仍可打开
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
  const cats = {
    expense: ['exp-food', 'exp-transport', 'exp-shopping', 'exp-housing', 'exp-fun', 'exp-daily', 'exp-health'],
    income: ['inc-salary', 'inc-parttime'],
  }
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
        categoryId: cats.expense[Math.floor(rnd() * cats.expense.length)],
        note: notes[Math.floor(rnd() * notes.length)],
        date,
        month: date.slice(0, 7),
        createdAt: Date.now() - back * 1000 - i,
      })
    }
    const payDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-05`
    rows.push({
      id: 'demo-pay-' + back,
      type: 'income',
      amount: 4200,
      categoryId: 'inc-salary',
      note: '月薪',
      date: payDate,
      month: payDate.slice(0, 7),
      createdAt: Date.now() - back * 1000,
    })
  }
  const tx = db.transaction('transactions', 'readwrite')
  for (const r of rows) tx.objectStore('transactions').put(r)
  await new Promise((res) => (tx.oncomplete = res))
})

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.row')
await page.screenshot({ path: `${SHOTS}/01-list.png` })

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

await page.click('.tab:has-text("统计")')
await page.waitForSelector('.legend-row')
await hideTabbar()
await page.screenshot({ path: `${SHOTS}/02-stats.png`, fullPage: true })
await showTabbar()

// 单分类环形图：演示数据里收入只有「工资」一个分类，正好覆盖跨满 360° 的情况
await page.click('.seg button:has-text("收入")')
await page.waitForTimeout(300)
const ringDrawn = await page.evaluate(() => {
  const svg = document.querySelector('.chart-wrap svg')
  if (!svg) return { ok: false, why: '找不到图表' }
  const circle = svg.querySelector('circle')
  const paths = svg.querySelectorAll('path')
  const box = (circle ?? paths[0])?.getBoundingClientRect()
  return { ok: Boolean(box && box.width > 20 && box.height > 20), w: box?.width, mode: circle ? '整圆' : '扇区' }
})
console.log(
  ringDrawn.ok
    ? `✓ 单分类时环形图正常渲染（${ringDrawn.mode}，宽 ${Math.round(ringDrawn.w)}px）`
    : `✗ 单分类环形图没画出来：${JSON.stringify(ringDrawn)}`
)
await hideTabbar()
await page.screenshot({ path: `${SHOTS}/08-single-category.png`, fullPage: true })
await showTabbar()
await page.click('.seg button:has-text("支出")')

// 日历视图
await page.click('.view-tabs button:has-text("日历")')
await page.waitForSelector('.cal-grid')
await hideTabbar()
await page.screenshot({ path: `${SHOTS}/09-calendar.png`, fullPage: true })
await showTabbar()

// 点一天看当日明细
const dayWithData = page.locator('.cal-cell.has-data').first()
await dayWithData.click()
await page.waitForSelector('.row')
await hideTabbar()
await page.screenshot({ path: `${SHOTS}/10-calendar-day.png`, fullPage: true })
await showTabbar()
console.log('✓ 日历视图与当日明细渲染正常')

await page.click('.tab:has-text("设置")')
await page.waitForSelector('.note-box')
await hideTabbar()
await page.screenshot({ path: `${SHOTS}/03-settings.png`, fullPage: true })
await showTabbar()

// 分类管理
await page.click('.list-item:has-text("分类管理")')
await page.waitForSelector('.sheet')
await page.waitForTimeout(400)
await page.screenshot({ path: `${SHOTS}/07-categories.png` })
await page.keyboard.press('Escape')

// 记账弹层
await page.click('.tab:has-text("明细")')
await page.click('.fab')
await page.waitForSelector('.sheet')
await page.waitForTimeout(400) // 等弹层动画结束再截图
await page.screenshot({ path: `${SHOTS}/04-add.png` })
await page.keyboard.press('Escape')

// 深色模式
await ctx2Dark(ctx, page)
async function ctx2Dark(_ctx, p) {
  await p.emulateMedia({ colorScheme: 'dark' })
  await p.click('.tab:has-text("统计")')
  await p.waitForSelector('.legend-row')
  await hideTabbar()
  await p.screenshot({ path: `${SHOTS}/05-dark-stats.png`, fullPage: true })
  await showTabbar()
  await p.emulateMedia({ colorScheme: 'light' })
}

// —— 离线验证：Service Worker 接管后断网仍能打开 ——
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
  timeout: 15000,
})
await ctx.setOffline(true)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.summary', { timeout: 10000 })
const offlineRows = await page.locator('.row').count()
console.log(`✓ 断网后仍可打开，列表仍有 ${offlineRows} 条记录`)
await page.screenshot({ path: `${SHOTS}/06-offline.png` })
await ctx.setOffline(false)

if (errors.length) {
  console.log('\n⚠ 控制台报错：')
  errors.forEach((e) => console.log('  ' + e))
} else {
  console.log('✓ 无控制台报错')
}

await browser.close()
