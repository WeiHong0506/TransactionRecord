"""生成一份结构与 TnG eWallet 对账单相同的测试 PDF，用于验证导入解析。
数据全是编的，只用来测结构：折行的 Description、抬头/页脚垃圾行、各类交易类型。

    pip install reportlab
    python3 scripts/make-sample-statement.py [输出路径] [密码]

给了密码就生成加密 PDF——真实的对账单基本都加密，这条路径必须能测。
"""
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import pdfencrypt
from reportlab.pdfgen import canvas
import os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/tng-sample.pdf'
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(os.path.dirname(OUT), exist_ok=True)

enc = pdfencrypt.StandardEncryption(PASSWORD, canPrint=1) if PASSWORD else None
W, H = landscape(A4)
c = canvas.Canvas(OUT, pagesize=landscape(A4), encrypt=enc)
cols = [40, 120, 210, 330, 600, 700]
header = ['Date', 'Status', 'Transaction Type', 'Description', 'Amount (RM)', 'Wallet Balance']
rows = [
    ('16/8/2026','Success','Reload',['Quick Reload Payment (via GO+','Balance)'],'RM10.25','RM10.25'),
    ('16/8/2026','Success','Transfer to Wallet',['Fund Transfer'],'RM10.25','RM0.00'),
    ('16/8/2026','Success','Reload',['Quick Reload Payment (via GO+','Balance)'],'RM6.00','RM6.00'),
    ('16/8/2026','Success','DuitNow QR TNGD',['Mixue Bukit Indah'],'RM6.00','RM0.00'),
    ('17/8/2026','Success','DUITNOW_RECEIVEFROM',['TAN WEI HONG'],'RM100.00','RM100.00'),
    ('18/8/2026','Success','DuitNow QR TNGD',['99 SPEEDMART BUKIT INDAH'],'RM23.40','RM76.60'),
    ('19/8/2026','Success','DuitNow QR TNGD',['SHELL SELECT JLN SKUDAI'],'RM50.00','RM26.60'),
    ('20/8/2026','Success','Payment',['GRABFOOD MALAYSIA SDN BHD'],'RM18.90','RM7.70'),
]

c.setFont('Helvetica', 9)
c.drawString(40, H-40, 'Touch n Go eWallet - Transaction Statement')
c.drawString(40, H-54, 'Wallet No: 01X-XXXXXXX     Period: 01/08/2026 - 31/08/2026')

y = H - 90
c.setFont('Helvetica-Bold', 9)
for x, h in zip(cols, header):
    c.drawString(x, y, h)

y -= 20
c.setFont('Helvetica', 9)
for date, status, ttype, desc, amt, bal in rows:
    c.drawString(cols[0], y, date); c.drawString(cols[1], y, status)
    c.drawString(cols[2], y, ttype); c.drawString(cols[3], y, desc[0])
    c.drawString(cols[4], y, amt);   c.drawString(cols[5], y, bal)
    for extra in desc[1:]:
        y -= 12
        c.drawString(cols[3], y, extra)
    y -= 26

c.drawString(40, y-20, 'Total Debit: RM108.55    Total Credit: RM116.25')
c.save()
print('wrote', OUT, '(encrypted)' if PASSWORD else '')
