"""生成结构与真实 TnG eWallet 对账单一致的测试 PDF。

数据全是编的，只用来验证解析结构。刻意复刻了真实账单里那些会把解析器绊倒的地方：
  - 页面是旋转的（横向表格画在纵向页面上）
  - 8 列，包含无用的 Reference / Details 长串数字
  - 一份文件两张表：钱包流水 + GO+ 理财流水，最后一列列名不同
  - 交易类型和描述都会折行（DUITNOW_RECEI / VEFROM）
  - 每页底部有系统邮件页脚

    pip install reportlab
    python3 scripts/make-sample-statement.py [输出路径] [密码] [flat|rotated]

给了密码就生成加密 PDF——真实的对账单基本都加密，这条路径必须能测。
"""
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import pdfencrypt
from reportlab.pdfgen import canvas
import os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/tng-sample.pdf'
PASSWORD = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else None
MODE = sys.argv[3] if len(sys.argv) > 3 else 'rotated'
os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)

COLS = [30, 88, 150, 252, 340, 470, 648, 726]
HEADER_WALLET = ['Date', 'Status', 'Transaction Type', 'Reference', 'Description',
                 'Details', 'Amount (RM)', 'Wallet Balance']
HEADER_GOPLUS = ['Date', 'Status', 'Transaction Type', 'Reference', 'Description',
                 'Details', 'Amount (RM)', 'GO+ Balance']

FOOTER = ('*This is a system generated email. Please do not reply to this email. '
          'For further enquiry, kindly contact our customer service.')

REF = '20260816101 10000010000 TNGOW3MY1 71748527803 097'
DET = '202608161310030850522063500740'

# (日期, 类型行列表, 描述行列表, 金额, 余额)
WALLET = [
    ('16/8/2026', ['Reload'], ['Quick Reload Payment (via GO+', 'Balance)'], 'RM10.25', 'RM10.25'),
    ('16/8/2026', ['Transfer to Wallet'], ['Fund Transfer'], 'RM10.25', 'RM0.00'),
    ('16/8/2026', ['Reload'], ['Quick Reload Payment (via GO+', 'Balance)'], 'RM6.00', 'RM6.00'),
    ('16/8/2026', ['DuitNow QR TNGD'], ['Mixue Bukit Indah'], 'RM6.00', 'RM0.00'),
    ('17/8/2026', ['DUITNOW_RECEI', 'VEFROM'], ['TAN WEI HONG'], 'RM100.00', 'RM100.00'),
    ('17/8/2026', ['eWallet Cash Out'], ['Via eWallet to GO+'], 'RM100.00', 'RM0.00'),
    ('17/8/2026', ['Reload'], ['Quick Reload Payment (via GO+', 'Balance)'], 'RM10.67', 'RM10.67'),
    ('17/8/2026', ['Payment'], ['CALTEX TAMAN PERLING'], 'RM10.67', 'RM0.00'),
    ('18/8/2026', ['Reload'], ['Quick Reload Payment (via GO+', 'Balance)'], 'RM8.40', 'RM8.40'),
    ('18/8/2026', ['DuitNow QR TNGD'], ['TAI KA LE'], 'RM8.40', 'RM0.00'),
    ('27/8/2026', ['Reload'], ['Quick Reload Payment (via GO+', 'Balance)'], 'RM17.65', 'RM17.65'),
    ('27/8/2026', ['Payment'], ["McDonald's"], 'RM17.65', 'RM0.00'),
    ('13/9/2026', ['Reload'], ['Quick Reload Payment (via GO+', 'Balance)'], 'RM30.35', 'RM30.35'),
    ('13/9/2026', ['DuitNow QR'], ['99 Speedmart'], 'RM30.35', 'RM0.00'),
]

GOPLUS = [
    ('16/8/2026', ['GO+ Daily Earnings'], ['Daily Interest'], 'RM0.0066', 'RM0.60'),
    ('17/8/2026', ['GO+ Cash In'], ['Via eWallet to GO+'], 'RM100.00', 'RM100.60'),
    ('18/8/2026', ['GO+ Daily Earnings'], ['Daily Interest'], 'RM0.0021', 'RM100.60'),
]

ROWS_PER_PAGE = 6
LINE_H = 11
ROW_GAP = 26


def draw_page(c, header, rows, title, W, H):
    c.setFont('Helvetica', 8)
    c.drawString(COLS[0], H - 36, 'TNG WALLET TRANSACTION HISTORY')
    c.drawString(COLS[0], H - 48, 'Registered Name: TAN WEI HONG    Wallet ID: 1000002908885746')
    c.drawString(COLS[0], H - 60, 'Transaction Period: 16 August 2026 - 14 September 2026')
    c.drawString(COLS[0], H - 78, title)

    y = H - 96
    c.setFont('Helvetica-Bold', 8)
    for x, h in zip(COLS, header):
        c.drawString(x, y, h)

    y -= 18
    c.setFont('Helvetica', 8)
    for date, types, descs, amt, bal in rows:
        c.drawString(COLS[0], y, date)
        c.drawString(COLS[1], y, 'Success')
        c.drawString(COLS[6], y, amt)
        c.drawString(COLS[7], y, bal)
        for i, part in enumerate(REF.split(' ')[:3]):
            c.drawString(COLS[3], y - i * LINE_H, part)
        c.drawString(COLS[5], y, DET)
        for i, t in enumerate(types):
            c.drawString(COLS[2], y - i * LINE_H, t)
        for i, d in enumerate(descs):
            c.drawString(COLS[4], y - i * LINE_H, d)
        y -= ROW_GAP + LINE_H * (max(len(types), len(descs)) - 1)

    c.setFont('Helvetica', 6)
    c.drawString(COLS[0], 24, FOOTER)


def render(c, rotated):
    """rotated=True 时把横向表格画到纵向页面上，并标记页面旋转——
    这正是真实对账单的做法，也是最容易把解析器带偏的地方。"""
    pages = []
    for i in range(0, len(WALLET), ROWS_PER_PAGE):
        pages.append((HEADER_WALLET, WALLET[i:i + ROWS_PER_PAGE], 'TNG WALLET TRANSACTION'))
    pages.append((HEADER_GOPLUS, GOPLUS, 'GO+ TRANSACTION'))

    for header, rows, title in pages:
        if rotated:
            # 横向表格画在纵向页面上：内容整体转 90°。
            # 这正是真实对账单的做法，也是最容易把解析器带偏的地方——
            # 按坐标直接分组得到的会是「列」而不是「行」。
            W, H = landscape(A4)          # 画布按横向用
            c.saveState()
            c.translate(A4[0], 0)
            c.rotate(90)
            draw_page(c, header, rows, title, W, H)
            c.restoreState()
        else:
            W, H = landscape(A4)
            draw_page(c, header, rows, title, W, H)
        c.showPage()


enc = pdfencrypt.StandardEncryption(PASSWORD, canPrint=1) if PASSWORD else None
pagesize = A4 if MODE == 'rotated' else landscape(A4)
c = canvas.Canvas(OUT, pagesize=pagesize, encrypt=enc)
render(c, MODE == 'rotated')
c.save()
print('wrote', OUT, MODE, '(encrypted)' if PASSWORD else '')
