#!/usr/bin/env python3
"""Writes manager/dist/assets/images/favicon.svg: a square in the brand green with the letters "WA" in Geist (white).

WhatsAI has no symbol of its own; browsers and the web app manifest still need an icon, so the icon is only the
initials in the project typeface, nothing else (not a logo). The letters are converted to SVG paths from the local
variable font (manager/dist/assets/fonts/geist-latin-wght-normal.woff2, weight 600), so the icon looks the same
everywhere without loading a font. The PNG icons are then rendered from this SVG by pwa-icons.mjs.

Deterministic: same font file, same output. Needs fontTools and brotli (pip install fonttools brotli).
Usage (from the repository root):
  python3 manager/patches/favicon-wa.py           # write favicon.svg
  python3 manager/patches/favicon-wa.py --check   # exit 1 if favicon.svg differs from what would be written
  node manager/patches/pwa-icons.mjs               # then regenerate the PNG icons
"""
import os
import sys

try:
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
except ImportError:
    print('favicon-wa.py needs fontTools and brotli: pip install fonttools brotli', file=sys.stderr)
    sys.exit(2)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.path.join(ROOT, 'manager', 'dist', 'assets', 'fonts', 'geist-latin-wght-normal.woff2')
OUT = os.path.join(ROOT, 'manager', 'dist', 'assets', 'images', 'favicon.svg')
TEXT = 'WA'
WEIGHT = 600
SIZE = 512          # viewBox side
TEXT_WIDTH = 0.62   # share of the side used by the letters (inside the 80% safe zone of maskable icons)
TRACKING = -0.02    # em
BACKGROUND = '#0e7a4d'  # brand primary (white letters on it: 5.4:1); same value as BACKGROUND in pwa-icons.mjs


def build():
    font = TTFont(FONT)
    font = instantiateVariableFont(font, {'wght': WEIGHT})
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font['head'].unitsPerEm
    names = [cmap[ord(ch)] for ch in TEXT]

    # lay out the glyphs on one line (font units), with the requested tracking
    x = 0
    placed = []
    for idx, name in enumerate(names):
        placed.append((name, x))
        x += glyphs[name].width + (TRACKING * upem if idx < len(names) - 1 else 0)

    bounds = BoundsPen(glyphs)
    for name, dx in placed:
        glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, dx, 0)))
    x_min, y_min, x_max, y_max = bounds.bounds
    scale = SIZE * TEXT_WIDTH / (x_max - x_min)
    # centre the ink box; font y goes up, SVG y goes down
    off_x = (SIZE - (x_max - x_min) * scale) / 2 - x_min * scale
    off_y = (SIZE + (y_max - y_min) * scale) / 2 + y_min * scale

    pen = SVGPathPen(glyphs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    for name, dx in placed:
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, off_x + dx * scale, off_y)))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">\n'
        f'<title>WhatsAI</title>\n'
        f'<rect width="{SIZE}" height="{SIZE}" fill="{BACKGROUND}"/>\n'
        f'<path fill="#fff" d="{pen.getCommands()}"/>\n'
        f'</svg>\n'
    )


def main():
    svg = build()
    if '--check' in sys.argv[1:]:
        current = open(OUT, encoding='utf-8').read() if os.path.isfile(OUT) else ''
        ok = current == svg
        print('ok: favicon.svg up to date' if ok else 'favicon.svg differs')
        return 0 if ok else 1
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(svg)
    print(f'favicon.svg written ({len(svg)} bytes)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
