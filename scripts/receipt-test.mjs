/**
 * 收据截图解析的测试。纯函数，不开浏览器、不跑 OCR。
 *
 * 盯的都是「会记错钱」的地方：
 *   1. 一张收据上有四五个数字，钱包余额和手续费长得最像答案
 *   2. 参考号被 OCR 读成带小数点的长数字时不能当金额
 *   3. 03/09/2026 按大马读是 9 月 3 日，按美式读是 3 月 9 日，差半年
 *   4. 收款要认成收入，不然资产会越记越少
 *   5. 参考号可能夹带账号片段，绝不能进备注
 */
import {
  ISSUERS,
  detectIssuer,
  repairMoney,
  parseReceipt,
  pickAmount,
  pickDate,
  pickDirection,
  pickMerchant,
  pickReference,
} from '../src/import/receipt.js'

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const L = (s) => s.trim().split('\n').map((x) => x.trim()).filter(Boolean)
const TODAY = '2026-09-15'

/* ---------- 各家真实版式（数字是编的） ---------- */

const TNG = `
Touch 'n Go eWallet
Payment Successful
RM 12.50
Paid to
ZUS Coffee Mid Valley
Transaction Date
15 Sep 2026, 10:23 AM
Reference ID
TNG20260915102311887
Wallet Balance
RM 238.75
`

const CIMB = `
CIMB OCTO
Transfer Successful
Amount
RM 1,200.00
Transfer Fee
RM 0.00
To
TAN AH KAU
Recipient Reference
SEPT RENTAL
Date & Time
15/09/2026 09:14:02
Reference No
2026091500091423
Available Balance
RM 8,431.09
`

const PBB = `
Public Bank
DuitNow Transfer
Status: Successful
Date : 15/09/2026
Amount : RM 58.00
From : 3141234567
To : MAXIS BERHAD
Reference : PBB6612340098
`

const MAYBANK_IN = `
Maybank2u
You have received
RM 350.00
Received from
LEE SIEW MEI
Transaction Date
15 Sep 2026
Reference
MB20260915774421
Account Balance
RM 12,880.40
`

console.log('\n[1] 认来源')
{
  ok('TnG', detectIssuer(TNG) === 'tng')
  ok('CIMB', detectIssuer(CIMB) === 'cimb')
  ok('Public Bank', detectIssuer(PBB) === 'publicbank')
  ok('Maybank', detectIssuer(MAYBANK_IN) === 'maybank')
  ok('认不出就是 other，不瞎猜', detectIssuer('随便一段文字 RM 10.00') === 'other')
  ok('来源列表最后一项是兜底的 other', ISSUERS[ISSUERS.length - 1].id === 'other')
}

console.log('\n[2] 挑金额：余额和手续费是最像的陷阱')
{
  const a = pickAmount(L(CIMB))
  ok('挑的是 1200 而不是余额 8431.09', a.value === 1200, String(a?.value))
  ok('也没挑成手续费 0.00', a.value !== 0)
  ok('标记为「有标签」，因为旁边写着 Amount', a.labeled === true)
  ok('把依据那一行带回来', a.line.includes('1,200.00'), a.line)

  const t = pickAmount(L(TNG))
  ok('TnG 挑 12.50 而不是钱包余额 238.75', t.value === 12.5, String(t?.value))

  const m = pickAmount(L(MAYBANK_IN))
  ok('Maybank 挑 350 而不是账户余额 12880.40', m.value === 350, String(m?.value))

  // OCR 偶尔会把参考号读出一个小数点
  const junk = pickAmount(L(`
    Transaction ID
    2026091500091423.00
    Amount
    RM 45.00
  `))
  ok('被误读成小数的参考号不会当金额', junk.value === 45, String(junk?.value))

  const bare = pickAmount(L(`
    20260915000914.23
  `))
  ok('没有 RM 标记的长数字整个不算金额', bare === null, JSON.stringify(bare))

  const none = pickAmount(L('Payment Successful\nThank you'))
  ok('一个金额都没有时返回 null，不编一个', none === null)

  // 竖排版式：标签一行，数字在下一行
  const vertical = pickAmount(L(`
    Wallet Balance
    RM 500.00
    Amount
    RM 30.00
  `))
  ok('标签在上一行也认得出', vertical.value === 30, String(vertical?.value))

  // 并列候选要报出来让人核对
  const rivals = pickAmount(L(`
    Amount RM 20.00
    Amount RM 35.00
  `))
  ok('有并列候选时把另一个也带回来', rivals.rivals.includes(20) || rivals.rivals.includes(35))
}

console.log('\n[2b] OCR 会把金额弄坏的那几种方式')
{
  // 真实 TnG 收据的标题就是「Touch 'n Go eWallet」，大字金额常常紧挨在下一行。
  // 曾经把光秃秃的 wallet 当成「余额」信号，结果整张收据最重要的那个数字
  // 被直接排除，界面上就是「没认出金额」。这一条钉死它。
  const header = pickAmount(L(`
    Touch 'n Go eWallet
    RM 12.50
  `))
  ok('标题里的 eWallet 不能把下一行的金额排除掉', header?.value === 12.5, JSON.stringify(header))

  // 但真正的余额还是要排除
  const bal = pickAmount(L(`
    Wallet Balance
    RM 238.75
  `))
  ok('「Wallet Balance」仍然算余额，排除', bal === null, JSON.stringify(bal))

  // RM 50 是完全正常的收据金额，之前因为强制两位小数被整个漏掉
  ok('整数令吉 RM 50', pickAmount(L('RM 50'))?.value === 50)
  ok('带千分位的整数 RM 1,200', pickAmount(L('Amount\nRM 1,200'))?.value === 1200)

  // OCR 把小数点读成逗号。千分位后面一定是三位，只跟两位的必然是小数点。
  ok('RM 12,50 当成 12.50', pickAmount(L('RM 12,50'))?.value === 12.5)
  ok('但 RM 1,200 仍是一千二', pickAmount(L('RM 1,200'))?.value === 1200)
  // 小数点两边被读出空格
  ok('RM 12. 50 当成 12.50', pickAmount(L('RM 12. 50'))?.value === 12.5)
  // RM 后面的 O 几乎只可能是 0
  ok('RM 1O.5O 当成 10.50', pickAmount(L('RM 1O.5O'))?.value === 10.5)
  ok('修复只动数字，不动商户名', repairMoney('ZUS Coffee Mid Valley') === 'ZUS Coffee Mid Valley')

  // 放开小数限制之后，最怕的是日期时间参考号混进来
  const noise = pickAmount(L(`
    Reference 20260915102311887
    15/09/2026 10:23 AM
    Successful
  `))
  ok('日期时间参考号都不算金额', noise === null, JSON.stringify(noise))
  ok('裸数字没有 RM 也没有小数就不算', pickAmount(L('50')) === null)
  // 参考号被切出前几位当金额是最隐蔽的错法
  const cut = pickAmount(L('RM 12.50\n20260915102311887'))
  ok('长数字串不能被切出一截当金额', cut?.value === 12.5, JSON.stringify(cut))
}

console.log('\n[2c] 真实 TnG 收据版式（OCR 原样输出，金额和参考号改过）')
{
  // 这段是从一张真实截图跑 OCR 拿到的原文，只把金额、日期、参考号换掉。
  // 它和我一开始编的样本长得完全不一样，而正是这些差异让解析失败过：
  //   · 金额在最顶上，带负号，RM 和数字之间没有空格
  //   · 标签和值在同一行（左右两栏），不是竖排
  //   · 有一行「Payment Method  eWallet Balance」——Balance 说的是付款方式
  //   · Wallet Ref 的长数字被折成两行
  //   · 底部导航栏和状态栏的乱码也会混进来
  const REAL = `
Details

-RM13.25

Transaction Type Payment
Merchant RESTORAN CONTOH (J) SDN BHD

Payment Details Payment - RESTORAN CONTOH (J) SDN

BHD
Payment Method eWallet Balance
Date/Time 15/09/2026 19:53:35

2026091510110000010000TNGOW3MY17174
Wallet Ref

8540264979
Status Successful
Transaction No. 4031087356

Merchants can scan the code for refund or
query transaction

4031087356

OQ V © = e°
Home Transfer Activity Profile
`
  const r = parseReceipt(REAL, { issuerId: 'tng', today: TODAY })
  ok('金额 13.25（RM 和数字之间没空格，还带负号）', r.amount === 13.25, String(r.amount))
  ok('日期 2026-09-15', r.date === '2026-09-15', String(r.date))
  ok('商户在同一行的右栏，也认得出', r.note === 'RESTORAN CONTOH (J) SDN BHD', r.note)
  ok('餐厅归到餐饮', r.categoryId === 'exp-food', String(r.categoryId))
  ok('方向是支出', r.direction === 'expense')
  ok('可信度 high', r.confidence === 'high', r.confidence)
  ok('没有任何警告', r.warnings.length === 0, r.warnings.join(' / '))
  // 底部那串交易号和 Wallet Ref 都不能被当成金额
  ok('交易号 4031087356 没被当成金额', r.amount !== 4031087356)
  ok('参考号没混进备注', !r.note.includes('4031087356') && !r.note.includes('TNGOW'))

  // 「Payment Method eWallet Balance」里的 Balance 指的是付款方式，
  // 不能因此把紧跟的金额排除掉
  const method = pickAmount(L(`
    Payment Method eWallet Balance
    RM 18.00
  `))
  ok('「Payment Method: eWallet Balance」不算余额行', method?.value === 18, JSON.stringify(method))
}

console.log('\n[3] 日期：大马是日/月/年')
{
  ok('15 Sep 2026', pickDate(L(TNG), TODAY).value === '2026-09-15')
  ok('15/09/2026 读成 9 月 15 日', pickDate(L(CIMB), TODAY).value === '2026-09-15')

  const us = pickDate(L('Date 09/15/2026'), TODAY)
  ok('09/15/2026 只可能是美式，自动反过来', us.value === '2026-09-15', us?.value)

  const amb = pickDate(L('Date 03/09/2026'), TODAY)
  ok('03/09/2026 按大马读成 9 月 3 日', amb.value === '2026-09-03', amb?.value)
  ok('并标记为有歧义，界面要提示', amb.ambiguous === true)

  ok('ISO 格式也认', pickDate(L('2026-09-15 10:00'), TODAY).value === '2026-09-15')
  ok('Sep 15, 2026 也认', pickDate(L('Sep 15, 2026'), TODAY).value === '2026-09-15')
  ok('马来文月份 Ogos 也认', pickDate(L('12 Ogos 2026'), TODAY).value === '2026-08-12')

  // 未来的收据不存在，认出未来日期说明认错了
  ok('未来日期一律不采信', pickDate(L('Date 20/12/2026'), TODAY) === null)
  ok('完全没有日期时返回 null', pickDate(L('Payment Successful'), TODAY) === null)
}

console.log('\n[4] 方向：收款不能记成支出')
{
  ok('TnG 付款是支出', pickDirection(L(TNG)) === 'expense')
  ok('CIMB 转出是支出', pickDirection(L(CIMB)) === 'expense')
  ok('Maybank 收款是收入', pickDirection(L(MAYBANK_IN)) === 'income')
  ok('退款是收入', pickDirection(L('Refund Successful RM 20.00')) === 'income')
  ok('认不出方向时默认支出', pickDirection(L('RM 10.00')) === 'expense')
}

console.log('\n[5] 商户名与参考号')
{
  ok('TnG 认出商户', pickMerchant(L(TNG)) === 'ZUS Coffee Mid Valley', pickMerchant(L(TNG)))
  ok('CIMB 认出收款人', pickMerchant(L(CIMB)) === 'TAN AH KAU', pickMerchant(L(CIMB)))
  ok('Public Bank 认出同行内的收款人', pickMerchant(L(PBB)) === 'MAXIS BERHAD', pickMerchant(L(PBB)))
  ok('Maybank 认出付款人', pickMerchant(L(MAYBANK_IN)) === 'LEE SIEW MEI', pickMerchant(L(MAYBANK_IN)))
  ok('没有商户信息时返回空串，不抄一句无关的话', pickMerchant(L('Payment Successful\nRM 10.00')) === '')

  ok('能抓到参考号供核对', pickReference(L(CIMB)) === '2026091500091423', pickReference(L(CIMB)))
}

console.log('\n[6] 整体解析')
{
  const r = parseReceipt(TNG, { issuerId: 'auto', today: TODAY })
  ok('成功', r.ok === true)
  ok('来源 tng', r.issuer === 'tng')
  ok('金额 12.50', r.amount === 12.5)
  ok('日期 2026-09-15', r.date === '2026-09-15')
  ok('支出', r.direction === 'expense')
  ok('备注是商户名', r.note === 'ZUS Coffee Mid Valley')
  ok('ZUS 归到餐饮', r.categoryId === 'exp-food', String(r.categoryId))
  ok('有标签 + 有日期 = 高可信', r.confidence === 'high', r.confidence)
  // 参考号可能夹带账号片段，只能给人看，不能进记录
  ok('参考号没有混进备注', !r.note.includes('TNG2026'))

  const c = parseReceipt(CIMB, { issuerId: 'cimb', today: TODAY })
  ok('CIMB 金额 1200', c.amount === 1200)
  ok('CIMB 备注是收款人', c.note === 'TAN AH KAU')
  ok('CIMB 参考号没进备注', !c.note.includes('2026091500091423'))

  const pb = parseReceipt(PBB, { issuerId: 'publicbank', today: TODAY })
  ok('Public Bank 金额 58', pb.amount === 58)
  ok('Maxis 归到通讯', pb.categoryId === 'exp-comm', String(pb.categoryId))

  const mb = parseReceipt(MAYBANK_IN, { issuerId: 'maybank', today: TODAY })
  ok('Maybank 收款解析成收入', mb.direction === 'income')
  ok('Maybank 金额 350', mb.amount === 350)

  // 选错来源要提醒，但不能拦着不给用
  const wrong = parseReceipt(TNG, { issuerId: 'cimb', today: TODAY })
  ok('选错来源时照样解析出来', wrong.amount === 12.5)
  ok('并且提醒来源对不上', wrong.warnings.some((w) => w.includes('看起来来自')))

  // 认不出金额时必须如实说，不能给个 0 就当成功
  const bad = parseReceipt('Payment Successful\nThank you for using', { today: TODAY })
  ok('认不出金额时 ok 为 false', bad.ok === false)
  ok('金额是 null 而不是 0', bad.amount === null)
  ok('可信度标为 low', bad.confidence === 'low')
  ok('并说明没认出金额', bad.warnings.some((w) => w.includes('没认出金额')))

  const empty = parseReceipt('', { today: TODAY })
  ok('空文字不崩', empty.ok === false)

  // 没有日期时退回今天，并且明确标记这是猜的
  const nodate = parseReceipt('Amount RM 9.90\nPaid to Kopitiam', { today: TODAY })
  ok('没日期时用今天', nodate.date === TODAY)
  ok('并标记日期是猜的', nodate.dateGuessed === true)
  ok('可信度降到 medium', nodate.confidence === 'medium', nodate.confidence)

  // 用户教过的规则要压过内置列表
  const learned = parseReceipt(TNG, { today: TODAY, learnedRules: { zus: 'exp-fun' } })
  ok('用户教过的分类优先', learned.categoryId === 'exp-fun', String(learned.categoryId))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`)
process.exit(fail === 0 ? 0 : 1)
