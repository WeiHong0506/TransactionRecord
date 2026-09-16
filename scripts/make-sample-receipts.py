#!/usr/bin/env python3
"""生成版式和真实收据一致的测试截图。金额、名字、参考号全是编的。

用来验 OCR 这条路：深色模式要能反色、低分辨率要能放大、
CIMB 那种同屏三个金额（付款 / 手续费 / 可用余额）要挑对。
"""
from PIL import Image, ImageDraw, ImageFont, ImageOps
import pathlib

OUT = pathlib.Path("/tmp/claude-0/receipts")
OUT.mkdir(parents=True, exist_ok=True)

FONTS = {
    True: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    False: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
}


def font(size, bold=False):
    try:
        return ImageFont.truetype(FONTS[bold], size)
    except OSError:
        return ImageFont.load_default()


def render(rows, height=1250, width=760):
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)
    y = 60
    for text, size, bold in rows:
        if not text:
            y += 30
            continue
        d.text((60, y), text, font=font(size, bold), fill=(20, 20, 20))
        y += size + 20
    return img


TNG = [
    ("Touch 'n Go eWallet", 34, True), ("Payment Successful", 28, False), ("", 0, False),
    ("RM 12.50", 64, True), ("", 0, False),
    ("Paid to", 22, False), ("ZUS Coffee Mid Valley", 30, True), ("", 0, False),
    ("Transaction Date", 22, False), ("15 Sep 2026, 10:23 AM", 28, False), ("", 0, False),
    ("Reference ID", 22, False), ("TNG20260915102311887", 26, False), ("", 0, False),
    # 钱包余额是最凶的陷阱：比付款金额大得多，长得一模一样
    ("Wallet Balance", 22, False), ("RM 238.75", 30, True),
]

CIMB = [
    ("CIMB OCTO", 34, True), ("Transfer Successful", 28, False), ("", 0, False),
    ("Amount", 22, False), ("RM 1,200.00", 46, True), ("", 0, False),
    ("Transfer Fee", 22, False), ("RM 0.50", 26, False), ("", 0, False),
    ("To", 22, False), ("TAN AH KAU", 30, True), ("", 0, False),
    ("Date & Time", 22, False), ("15/09/2026 09:14:02", 26, False), ("", 0, False),
    ("Reference No", 22, False), ("2026091500091423", 26, False), ("", 0, False),
    ("Available Balance", 22, False), ("RM 8,431.09", 30, True),
]

# 真实 TnG 收据的版式：顶上一条蓝色标题栏，超大号蓝字金额，
# 下面是左右两栏的表格。和上面那种竖排样式完全不同——
# 默认的 PSM 6 分段模式会把那行超大字整行丢掉，这张图就是用来钉住这件事的。
def render_real_tng():
    W, H = 1320, 2400
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 300], fill=(0, 82, 204))
    d.text((W // 2 - 70, 200), "Details", font=font(46, True), fill=(255, 255, 255))
    # 金额：超大号、蓝色、带负号、RM 和数字之间没有空格
    d.text((48, 360), "-RM13.25", font=font(110, False), fill=(20, 110, 240))

    rows = [
        ("Transaction Type", "Payment"),
        ("Merchant", "RESTORAN CONTOH (J) SDN BHD"),
        ("Payment Method", "eWallet Balance"),
        ("Date/Time", "15/09/2026 19:53:35"),
        ("Status", "Successful"),
        ("Transaction No.", "4031087356"),
    ]
    y = 620
    for k, v in rows:
        d.line([48, y - 30, W - 48, y - 30], fill=(225, 225, 225), width=2)
        d.text((48, y), k, font=font(38), fill=(110, 110, 110))
        vw = d.textlength(v, font=font(38))
        d.text((W - 48 - vw, y), v, font=font(38), fill=(20, 20, 20))
        y += 130
    return img


render_real_tng().save(OUT / "tng-real-layout.png")

tng = render(TNG, height=1200)
tng.save(OUT / "tng-light.png")
# 深色模式：浅字深底。Tesseract 对这种图几乎认不出来，所以要先反色。
ImageOps.invert(tng).save(OUT / "tng-dark.png")
# 低分辨率：老手机，或者被转发压过的截图
tng.resize((tng.width // 2, tng.height // 2), Image.LANCZOS).save(OUT / "tng-small.png")
render(CIMB).save(OUT / "cimb.png")

print(f"已生成 4 张测试收据到 {OUT}")
