"""Build vendor/osifont/osifont-dwg.woff: osifont widened to AutoCAD's text metrics.

Drawings are laid out for the font they were drafted with, usually simplex.shx
or Arial, and MTEXT wraps inside a box sized for that font. A narrower stand-in
wraps later than the author saw, a wider one earlier, and labels placed next to
a text block end up overlapping it.

K is measured, not guessed: AutoCAD stores the rendered width of every MTEXT
(extentsWidth). Across 155 single-line MTEXT entities of a real detail drawing
(simplex text, 2024) the median of AutoCAD width / osifont width was 1.148
(p25 0.73, p75 1.23). scripts/calibrate_font.mjs is not kept; rerun the
measurement on more drawings before changing K.

GPL-3.0 with font exception allows modification; the name table records it.

    python3 scripts/make_font.py   (needs: pip install fonttools)
"""
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import ttProgram

K = 1.15  # median AutoCAD extentsWidth / osifont width, see docstring

here = Path(__file__).resolve().parent.parent / "vendor" / "osifont"
font = TTFont(here / "osifont.ttf")

glyf, hmtx = font["glyf"], font["hmtx"]
for name in font.getGlyphOrder():
    g = glyf[name]
    if g.isComposite():
        for c in g.components:
            c.x = round(c.x * K)
    elif g.numberOfContours > 0:
        g.coordinates.scale((K, 1))
        g.coordinates.toInt()
        g.program = ttProgram.Program()
        g.program.fromBytecode(b"")
    advance, lsb = hmtx[name]
    hmtx[name] = (round(advance * K), round(lsb * K))
for name in font.getGlyphOrder():
    glyf[name].recalcBounds(glyf)  # bounding boxes after scaling


def scale_x(obj, seen=None):
    """Scale every horizontal value in GPOS: pair kerning and mark anchors."""
    seen = seen or set()
    if id(obj) in seen or obj is None or isinstance(obj, (int, float, str, bytes)):
        return
    seen.add(id(obj))
    if isinstance(obj, (list, tuple)):
        for item in obj:
            scale_x(item, seen)
        return
    for attr in ("XAdvance", "XPlacement", "XCoordinate"):
        if isinstance(getattr(obj, attr, None), int):
            setattr(obj, attr, round(getattr(obj, attr) * K))
    for value in list(getattr(obj, "__dict__", {}).values()):
        scale_x(value, seen)


scale_x(font["GPOS"].table)
for tag in ("cvt ", "fpgm", "prep", "gasp"):
    if tag in font:
        del font[tag]

head = font["head"]
head.xMin, head.xMax = round(head.xMin * K), round(head.xMax * K)
font["hhea"].advanceWidthMax = max(a for a, _ in hmtx.metrics.values())
font["OS/2"].xAvgCharWidth = round(font["OS/2"].xAvgCharWidth * K)

name = font["name"]
for rec in list(name.names):
    if rec.nameID in (1, 4):
        name.setName("osifont-dwg", rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    if rec.nameID == 6:
        name.setName("osifont-dwg", 6, rec.platformID, rec.platEncID, rec.langID)
    if rec.nameID == 0:
        name.setName(
            rec.toUnicode() + "\n\nModified by dwg.moonforge.tech: glyphs scaled 115% horizontally to match AutoCAD text metrics.",
            0, rec.platformID, rec.platEncID, rec.langID,
        )

font.flavor = "woff"
out = here / "osifont-dwg.woff"
font.save(out)
print(out, out.stat().st_size)
