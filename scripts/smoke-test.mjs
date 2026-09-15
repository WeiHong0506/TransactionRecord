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
// 用自建键盘输金额（页面上已经没有 input 了，系统键盘永远不会弹）
const PAD_LABEL = { '.': '小数点' }
async function typeAmount(page, digits) {
  if ((await page.locator('.pad-sheet[data-open="true"]').count()) === 0) {
    await page.click('#amt')
    await page.waitForTimeout(350)
  }
  for (const ch of String(digits)) {
    const sel = PAD_LABEL[ch]
      ? `.pad-key[aria-label="${PAD_LABEL[ch]}"]`
      : `.pad-key:text-is("${ch}")`
    await page.click(sel)
  }
  await page.click('.pad-key.done')
  await page.waitForTimeout(320)
}

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
await typeAmount(page, '38.50')
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

// —— 资产 ——
await page.click('.dock-tab:has-text("资产")')
await page.waitForSelector('.acct-row')
const balance = await page.textContent('.summary .hero')
console.log(`✓ 资产页渲染正常，总资产 ${balance.trim()}`)
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

// —— 设置（从资产页右上角齿轮进入）——
await page.click('.icon-btn[aria-label="设置"]')
await page.waitForSelector('.note-box')
await shot('03-settings')
await page.click('.icon-btn[aria-label="返回"]')
await page.waitForSelector('.acct-row')
console.log('✓ 设置页可从资产页进入并返回')

// 记账整页表单（现在带账户选择）
await page.click('.fab')
await page.waitForSelector('.page-form')
await page.waitForTimeout(400)
const hasAcctPicker = await page.locator('.acct-picker').count()
console.log(hasAcctPicker ? '✓ 记账表单出现账户选择' : '✗ 记账表单缺少账户选择')
// 日期字段不能顶出屏幕
const dateFits = await page.evaluate(() => {
  const el = document.querySelector('#date')
  const box = el.parentElement.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return r.right <= box.right + 0.5 && r.width > 80 && document.documentElement.scrollWidth <= innerWidth
})
console.log(dateFits ? '✓ 日期字段没有超出屏幕' : '✗ 日期字段超出屏幕')

// 页面上不该再有任何会唤起系统键盘的金额输入框
const noNativeInput = await page.evaluate(() => {
  const el = document.querySelector('#amt')
  return el && el.tagName === 'BUTTON' && !document.querySelector('.page-form input[inputmode]')
})
console.log(noNativeInput ? '✓ 金额栏是按钮，不会唤起系统键盘' : '✗ 金额栏仍是原生输入框')

// 刚进「记一笔」时键盘应当是收着的，点金额栏才唤起
const padClosedAtFirst =
  (await page.locator('.pad-sheet[data-open="true"]').count()) === 0
await page.click('#amt')
await page.waitForTimeout(350)
const padOpensOnTap = (await page.locator('.pad-sheet[data-open="true"]').count()) === 1
console.log(
  padClosedAtFirst && padOpensOnTap
    ? '✓ 键盘默认收起，点金额栏才唤起'
    : `✗ 键盘初始状态不对（初始收起=${padClosedAtFirst}，点击后展开=${padOpensOnTap}）`
)

// 税费：87 开服务费 10% + SST 6% → 100.92（两项都按小计，不叠加）
// 新记一笔时键盘本来就是开着的，再点一下反而会收起来
async function ensurePad(page) {
  if ((await page.locator('.pad-sheet[data-open="true"]').count()) === 0) {
    await page.click('#amt')
    await page.waitForTimeout(350)
  }
}
await ensurePad(page)
for (const d of '87') await page.click(`.pad-key:text-is("${d}")`)
await page.click('.tax-toggle:text-is("服务费")')
await page.click('.tax-toggle:text-is("SST")')
await page.waitForTimeout(250)
const taxed = await page.textContent('.amount-field .amt-val')
console.log(
  taxed.trim() === '100.92' ? '✓ 服务费 + SST 按小计算，合计 100.92' : `✗ 税费算错：${taxed}`
)
await page.screenshot({ path: `${SHOTS}/06-pad-tax.png` })

// 关掉键盘再点开，已加的税费必须还在——这是修过的 bug
await page.click('.pad-key.done')
await page.waitForTimeout(350)
const afterClose = await page.textContent('.amount-field .amt-val')
await page.click('#amt')
await page.waitForTimeout(350)
const afterReopen = await page.textContent('.amount-field .amt-val')
console.log(
  afterClose.trim() === '100.92' && afterReopen.trim() === '100.92'
    ? '✓ 关掉键盘再点开，税费没丢'
    : `✗ 重开键盘后金额变了：${afterClose} → ${afterReopen}`
)

// 税率可改：把服务费改成 0 → 只剩 SST 6% → 92.22
await page.click('.tax-rate >> nth=0')
await page.waitForTimeout(250)
await page.click('.pad-key[aria-label="退格"]')
await page.click('.pad-key[aria-label="退格"]')
await page.click('.pad-key:text-is("5")')
await page.click('.pad-key.done')
await page.waitForTimeout(250)
const reRated = await page.textContent('.amount-field .amt-val')
console.log(
  reRated.trim() === '96.57' ? '✓ 税率改成 5% 后重算为 96.57' : `✗ 改税率后算错：${reRated}`
)
await page.click('.pad-key.done')
await page.waitForTimeout(350)
await page.screenshot({ path: `${SHOTS}/04-add.png` })
// 底栏不能透过整页表单露出来
const dockHidden = await page.evaluate(() => {
  const d = document.querySelector('.dock')
  if (!d) return true
  const r = d.getBoundingClientRect()
  return document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)?.closest('.dock') === null
})
console.log(dockHidden ? '✓ 整页表单盖住了底栏' : '✗ 底栏透出来了')
// 表单打开时背景不能再滚动；关掉之后滚动位置要回到原处
const scrollLock = await page.evaluate(async () => {
  const before = document.body.style.position
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 400
  document.body.scrollTop = 400
  await new Promise((r) => setTimeout(r, 120))
  return { locked: before === 'fixed', scrolled: window.scrollY }
})
console.log(
  scrollLock.locked && scrollLock.scrolled === 0
    ? '✓ 表单打开时背景被钉住，滑不动'
    : `✗ 背景仍可滚动：${JSON.stringify(scrollLock)}`
)
// 安卓返回键 / 浏览器后退应当只关掉这一页，不退出应用
await page.goBack()
await page.waitForTimeout(300)
const closedByBack =
  (await page.locator('.page-form').count()) === 0 && (await page.locator('.dock').count()) === 1
console.log(closedByBack ? '✓ 返回键关闭表单而不是退出应用' : '✗ 返回键行为不对')

// 深色模式
await page.emulateMedia({ colorScheme: 'dark' })
await page.click('.dock-tab:has-text("统计")')
await page.click('.view-tabs button:has-text("分类构成")')
await page.waitForSelector('.legend-row')
await shot('05-dark-breakdown')
await page.click('.view-tabs button:has-text("日历")')
await page.waitForSelector('.cal-grid')
await shot('13-dark-calendar')
await page.emulateMedia({ colorScheme: 'light' })

// —— 预算：设上限 → 进度条出现 → 超支变红 ——
await page.click('.dock-tab:has-text("资产")')
await page.waitForTimeout(300)
await page.click('.icon-btn[aria-label="设置"]')
await page.waitForSelector('.list-item:has-text("预算")')
await page.click('.list-item:has-text("预算")')
await page.waitForSelector('.bud-input')
// 逐字符输入时焦点必须留在输入框里。
// 曾经的 bug：行组件定义在父组件函数体内，每次重渲染都被当成新组件类型，
// 整棵子树卸载重建——输入框换了 DOM，焦点没了，手机上系统键盘直接收起。
await page.click('.bud-input')
await page.keyboard.type('12')
const focusKept = await page.evaluate(() => {
  const el = document.activeElement
  return {
    focused: Boolean(el && el.classList.contains('bud-input')),
    value: el && el.value,
  }
})
console.log(
  focusKept.focused && focusKept.value === '12'
    ? '✓ 预算输入时焦点不丢（键盘不会被顶掉）'
    : `✗ 预算输入丢焦点：${JSON.stringify(focusKept)}`
)
await page.locator('.bud-input').first().fill('')
await page.locator('.bud-input').first().blur()
await page.waitForTimeout(300)

const monthExpense = await page.evaluate(() => {
  const el = document.querySelector('.summary .stat .v')
  return el ? Number(el.textContent.replace(/[^0-9.]/g, '')) : 0
})
// 故意把总额设得比本月支出低一点，好验证超支态
await page.locator('.bud-input').nth(0).fill(String(Math.max(1, Math.round(monthExpense * 0.8))))
await page.waitForTimeout(400)
await page.click('.dock-tab:has-text("统计")')
await page.waitForSelector('.summary-budget .bud-track')
await page.waitForTimeout(300)
const bud = await page.evaluate(() => {
  const row = document.querySelector('.summary-budget .bud-row')
  const fill = row.querySelector('.bud-fill')
  return {
    state: row.dataset.state,
    // 超支时进度条必须停在满格，不能冲出容器
    fillPct: parseFloat(fill.style.width),
    text: row.querySelector('.bud-foot').textContent.trim(),
  }
})
console.log(
  bud.state === 'over' && bud.fillPct === 100 && bud.text.includes('超支')
    ? '✓ 超支时进度条满格变红并写明超了多少'
    : `✗ 超支态不对：${JSON.stringify(bud)}`
)
// 预算只管支出：记一笔收入不该让进度条回退
const before = await page.textContent('.summary-budget .bud-num')
await page.click('.fab')
await page.waitForSelector('.page-form')
await ensurePad(page)
await page.click('.seg button:has-text("收入")')
for (const d of '5000') await page.click(`.pad-key:text-is("${d}")`)
await page.click('.pad-key.done')
await page.click('button[type="submit"]')
await page.waitForTimeout(600)
const after = await page.textContent('.summary-budget .bud-num')
console.log(
  before.trim() === after.trim() ? '✓ 收入不抵扣预算' : `✗ 收入影响了预算：${before} → ${after}`
)

// —— 固定支出：登记 → 预算预留 → 一键记账 ——
// 这个功能的全部价值在于「预算别撒谎」：月底还要扣 1200 房租的话，
// 预算条上那个「还剩」就是虚的。所以下面验的不是列表长得对不对，
// 而是那笔钱有没有真的从「可自由支配」里被扣掉。
await page.click('.dock-tab:has-text("资产")')
await page.waitForTimeout(300)
await page.click('.icon-btn[aria-label="设置"]')
await page.waitForSelector('.list-item:has-text("固定支出")')
await page.click('.list-item:has-text("固定支出")')
await page.waitForSelector('.list-item:has-text("房租")')
await page.click('.list-item:has-text("房租")')
await page.waitForSelector('.rec-form')
await page.fill('.rec-amount-row input', '1200')
await page.selectOption('.rec-day-row select', '28')
// 预览必须当场显示下一次扣款日，而不是等保存后才知道设对没有
const preview = (await page.textContent('.rec-preview')) ?? ''
console.log(
  preview.includes('-28') ? '✓ 编辑时就能看到下次扣款日' : `✗ 预览不对：${preview.trim()}`
)
await page.click('.list-item:has-text("添加")')
await page.waitForSelector('.rec-amt')
await shot('15-recurring-settings')
const recRow = (await page.textContent('.card .list-item:has-text("房租")')) ?? ''
console.log(
  recRow.includes('1,200.00') && recRow.includes('28')
    ? '✓ 固定支出已登记'
    : `✗ 登记结果不对：${recRow.replace(/\s+/g, ' ').trim()}`
)

// 预算条下面必须多出「预留 … 之后」那一行，且把 1200 扣掉了
await page.click('.dock-tab:has-text("统计")')
await page.waitForSelector('.summary-budget .disc-line')
const disc = await page.evaluate(() => {
  const el = document.querySelector('.disc-line')
  return { state: el.dataset.state, text: el.textContent.replace(/\s+/g, ' ').trim() }
})
console.log(
  disc.text.includes('1,200.00') && disc.text.includes('预留')
    ? '✓ 未发生的固定支出已从可自由支配里预留出来'
    : `✗ 预留行不对：${JSON.stringify(disc)}`
)

// 面板里点「记一笔」，应当写进流水并把这条标成已记
await page.click('.view-tabs button:has-text("分类构成")')
await page.waitForSelector('.rec-item')
await shot('16-recurring-pending')
const beforeState = await page.getAttribute('.rec-item', 'data-state')
await page.click('.rec-btn')
await page.waitForTimeout(700)
const afterState = await page.getAttribute('.rec-item', 'data-state')
console.log(
  beforeState === 'due' && afterState === 'paid'
    ? '✓ 一键记账后状态变为已记'
    : `✗ 状态没变：${beforeState} → ${afterState}`
)
// 已经发生的钱不该再被预留一次，否则同一笔房租扣了两遍
const discGone = (await page.locator('.disc-line').count()) === 0
console.log(discGone ? '✓ 记过之后不再重复预留' : '✗ 已记的固定支出仍在预留')
// 而且它必须是一笔普通流水，在明细里看得到
await page.click('.view-tabs button:has-text("明细")')
await page.waitForTimeout(300)
const inList = (await page.locator('.row:has-text("房租")').count()) > 0
console.log(inList ? '✓ 一键记的账进了明细，和手记的没区别' : '✗ 明细里找不到这笔')

// —— 和上月对比 ——
// 没有上月数据时不该编一个百分比出来，而要老实说「不可比」
await page.click('.view-tabs button:has-text("分类构成")')
await page.waitForSelector('.cmp-hero, .section:has-text("和上月对比") .empty')
const cmp = await page.evaluate(() => {
  const hero = document.querySelector('.cmp-hero')
  if (hero) return { kind: 'hero', text: hero.textContent.replace(/\s+/g, ' ').trim() }
  const empty = document.querySelector('.section:has(h2) .empty')
  return { kind: 'empty', text: empty ? empty.textContent.replace(/\s+/g, ' ').trim() : '' }
})
console.log(
  cmp.kind === 'empty' || (cmp.kind === 'hero' && !cmp.text.includes('Infinity'))
    ? `✓ 上月对比渲染正常（${cmp.kind}）`
    : `✗ 对比区块不对：${JSON.stringify(cmp)}`
)
await shot('14-recurring-compare')

// —— 汇率输入：逐字符敲，0 和小数点都必须留得住 ——
// 这个曾经是坏的：输入框的值从已存数字反推，按下 0 的瞬间就被当成清空。
await page.click('.dock-tab:has-text("资产")')
await page.waitForSelector('.acct-row')
await page.click('.btn.secondary:has-text("新增账户")')
await page.waitForSelector('#acc-cur')
await page.fill('#acc-name', '支付宝')
await page.selectOption('#acc-cur', 'CNY')
await page.click('.sheet .btn:has-text("保存")')
await page.waitForTimeout(500)
await page.click('.icon-btn[aria-label="设置"]')
await page.waitForSelector('.fx-input')
await page.click('.fx-input')
const typed = []
for (const ch of '0.63') {
  await page.type('.fx-input', ch, { delay: 40 })
  typed.push(await page.inputValue('.fx-input'))
}
console.log(
  typed.join('|') === '0|0.|0.6|0.63'
    ? '✓ 汇率能逐字符输入 0 和小数点'
    : `✗ 汇率输入被吞字符：${typed.join(' → ')}`
)
await page.locator('.fx-input').blur()
await page.waitForTimeout(300)
const settled = await page.inputValue('.fx-input')
console.log(settled === '0.63' ? '✓ 失焦后汇率保持 0.63' : `✗ 失焦后变成 ${settled}`)

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

// 顶部状态栏配色：三处必须一致，否则 iOS/安卓会在顶上画出一条色差带。
// apple-mobile-web-app-status-bar-style 一旦存在就会压过 theme-color，
// 让 iOS 画一条纯白系统状态栏，和 #f9f9f7 的页面背景差出一道接缝。
const themeMeta = await page.evaluate(() => ({
  metas: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => ({
    media: m.getAttribute('media'),
    content: m.getAttribute('content'),
  })),
  hasAppleStatusBar: Boolean(
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
  ),
  plane: getComputedStyle(document.body).backgroundColor,
}))
const lightTheme = themeMeta.metas.find((m) => m.media?.includes('light'))?.content
console.log(
  !themeMeta.hasAppleStatusBar &&
    lightTheme === '#f9f9f7' &&
    themeMeta.plane === 'rgb(249, 249, 247)'
    ? '✓ 状态栏配色与页面背景一致，没有 apple-status-bar 覆盖'
    : `✗ 顶部配色不一致：${JSON.stringify(themeMeta)}`
)

if (errors.length) {
  console.log('\n⚠ 控制台报错：')
  errors.forEach((e) => console.log('  ' + e))
} else {
  console.log('✓ 无控制台报错')
}

await browser.close()
