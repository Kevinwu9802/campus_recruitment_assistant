# -*- coding: utf-8 -*-
"""生成应用图标：build/icon.png (512) + build/icon.ico (多尺寸)"""
import os
from PIL import Image, ImageDraw

S = 1024  # 超采样尺寸
OUT = os.path.join(os.path.dirname(__file__), '..', 'build')
os.makedirs(OUT, exist_ok=True)

# 品牌色：顶部 #4F8CFF 蓝 -> 底部 #A78BFA 紫（匹配应用深色主题）
c1 = (79, 140, 255)
c2 = (167, 139, 250)

# --- 对角渐变底 (左上亮蓝 -> 右下紫) ---
base = Image.new('RGB', (S, S))
d = ImageDraw.Draw(base)
for y in range(S):
    t = y / (S - 1)
    # 加一点点对角感：沿 x 也过渡
    for x in range(0, S, 4):
        tx = x / (S - 1)
        m = 0.35 * tx + 0.65 * t
        r = int(c1[0] + (c2[0] - c1[0]) * m)
        g = int(c1[1] + (c2[1] - c1[1]) * m)
        b = int(c1[2] + (c2[2] - c1[2]) * m)
        d.rectangle([x, y, x + 4, y], fill=(r, g, b))

# --- 圆角遮罩 ---
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=210, fill=255)

# --- 合成带透明圆角的图标 ---
icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(base, (0, 0), mask)

dr = ImageDraw.Draw(icon)

# --- 白色闪电 polygon (⚡) ---
bolt = [
    (0.62, 0.14), (0.36, 0.52), (0.51, 0.52), (0.37, 0.86),
    (0.70, 0.47), (0.55, 0.47), (0.65, 0.14),
]
pts = [(int(x * S), int(y * S)) for (x, y) in bolt]
dr.polygon(pts, fill=(255, 255, 255, 255))

# --- 加一点内高光：闪电轮廓上缘描一层淡蓝，增加立体感 ---
outline = [(int(x * S + 6), int(y * S - 6)) for (x, y) in bolt]
dr.polygon(outline, outline=(255, 255, 255, 160))

# --- 导出 512 PNG（Linux / 源码用） ---
png512 = icon.resize((512, 512), Image.LANCZOS)
png512.save(os.path.join(OUT, 'icon.png'))
print('生成 build/icon.png  512x512')

# --- 导出多尺寸 ICO（Windows） ---
ico = icon.resize((256, 256), Image.LANCZOS)
ico.save(os.path.join(OUT, 'icon.ico'),
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('生成 build/icon.ico  多尺寸')

# --- 也导出 1024 原图，方便日后高清/其它平台 ---
icon.save(os.path.join(OUT, 'icon-1024.png'))
print('生成 build/icon-1024.png')
print('完成 ✔')
