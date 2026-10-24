#!/usr/bin/env python3
"""Draws the Dash Express app icons (Dot, the depot boss, on blue). Needs: pip install cairosvg
Run from the project folder:  python3 scripts/make-icons.py
The PNGs it writes are committed, so you only need this if you want to change the artwork."""
import cairosvg, pathlib

INK = '#1b1f3b'
BLUE = '#2c68e0'

def dot(scale, tx, ty):
    s = scale
    return f'''<g transform="translate({tx} {ty}) scale({s})" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">
  <circle cx="32" cy="36" r="22" fill="#ffd23f"/>
  <path d="M10 30 a22 22 0 0 1 44 0z" fill="#e63946"/>
  <rect x="30" y="24" width="28" height="6" rx="3" fill="#e63946"/>
  <circle cx="24" cy="38" r="2.6" fill="{INK}" stroke="none"/><circle cx="40" cy="38" r="2.6" fill="{INK}" stroke="none"/>
  <path d="M23 46 q9 8 18 0" fill="none" stroke-width="2.6"/>
  <circle cx="32" cy="17" r="3.4" fill="#fff" stroke-width="1.6"/>
</g>'''

def icon(size, rounded=True, content=0.78):
    r = int(size * 0.22) if rounded else 0
    s = size * content / 64
    off = (size - 64 * s) / 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
<rect width="{size}" height="{size}" rx="{r}" fill="{BLUE}"/>
<circle cx="{size*0.5}" cy="{size*0.52}" r="{size*0.40}" fill="#4a86f0"/>
{dot(s, off, off + size*0.02)}
</svg>'''

out = pathlib.Path('public/icons')
out.mkdir(parents=True, exist_ok=True)
for name, size, rounded, content in [
    ('icon-192.png', 192, True, 0.78),
    ('icon-512.png', 512, True, 0.78),
    ('icon-maskable-512.png', 512, False, 0.56),  # full-bleed, with the artwork kept inside the safe zone
    ('apple-touch-icon.png', 180, False, 0.70),   # iOS rounds the corners itself
]:
    cairosvg.svg2png(bytestring=icon(size, rounded, content).encode(), write_to=str(out / name), output_width=size, output_height=size)
(out / 'favicon.svg').write_text(icon(64, True, 0.8))
print('icons written to', out)
