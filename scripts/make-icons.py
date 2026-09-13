"""生成 PWA 所需的各尺寸图标。改了配色后重新跑一次即可：
   python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

BLUE = (42, 120, 214, 255)
BLUE_DEEP = (24, 79, 149, 255)
WHITE = (255, 255, 255, 255)


def gradient(size):
    img = Image.new('RGBA', (size, size), BLUE)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(size - 1, 1)
        c = tuple(round(BLUE[i] + (BLUE_DEEP[i] - BLUE[i]) * t) for i in range(4))
        d.line([(0, y), (size, y)], fill=c)
    return img


def draw_mark(img, scale=1.0):
    """环形图标记：和应用里的分类环形图同一个形，纯几何，不依赖字体。"""
    size = img.width
    ss = 4  # 超采样，边缘更干净
    layer = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    S = size * ss
    r_out = S * 0.30 * scale
    r_in = S * 0.175 * scale
    cx = cy = S / 2

    # 三段弧，段与段之间留缝隙，读起来就是一张占比环形图
    segments = [(-84, 96), (102, 192), (198, 264)]
    for start, end in segments:
        d.pieslice([cx - r_out, cy - r_out, cx + r_out, cy + r_out],
                   start, end, fill=WHITE)
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=(0, 0, 0, 0))

    layer = layer.resize((size, size), Image.LANCZOS)
    img.alpha_composite(layer)


def rounded(img, radius_ratio=0.225):
    size = img.width
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
    )
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def build(size, name, maskable=False, square=False):
    img = gradient(size)
    draw_mark(img, scale=0.78 if maskable else 1.0)
    if not square and not maskable:
        img = rounded(img)
    img.save(os.path.join(OUT, name))
    print('wrote', name, f'{size}x{size}')


build(192, 'icon-192.png')
build(512, 'icon-512.png')
build(512, 'maskable-512.png', maskable=True)   # 安全区内留白，供系统裁切
build(180, 'apple-touch-icon.png', square=True)  # iOS 自己做圆角，不能预先透明
build(32, 'favicon-32.png')
