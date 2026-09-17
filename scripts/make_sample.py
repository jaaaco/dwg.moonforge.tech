"""Build the sample drawing shipped with the viewer (public/samples/).

The sample is our own work, so it can be published: a small single-storey
house plan with the things a real DWG carries - layers with colours, walls
as polylines, hatched walls, arcs for door swings, dimensions, MTEXT and
blocks. Written as DXF with ezdxf.

It stays a DXF on purpose: LibreDWG's dxf2dwg (0.14) writes a DWG that its own
reader parses with errors and that the viewer draws as an empty canvas. A real
DWG sample needs a file saved by a CAD program, with rights to publish it.

    python3 scripts/make_sample.py   (needs: pip install ezdxf)
"""
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

OUT = Path(__file__).resolve().parent.parent / "public" / "samples"
OUT.mkdir(parents=True, exist_ok=True)

doc = ezdxf.new("R2000", setup=True)
doc.header["$INSUNITS"] = 5  # centimetres
msp = doc.modelspace()
for name, color in [("WALLS", 7), ("WALL-HATCH", 8), ("DOORS", 3), ("WINDOWS", 4),
                    ("DIMENSIONS", 1), ("ROOM-NAMES", 2), ("FURNITURE", 9), ("ELECTRICAL", 6), ("GRID", 252)]:
    doc.layers.add(name, color=color)

T = 25  # wall thickness, cm
W, H = 1200, 900  # outer size, cm

def wall_rect(x0, y0, x1, y1):
    msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={"layer": "WALLS"})

# outer walls: outer and inner outline, hatched in between
wall_rect(0, 0, W, H)
wall_rect(T, T, W - T, H - T)
hatch = msp.add_hatch(color=8, dxfattribs={"layer": "WALL-HATCH"})
hatch.set_pattern_fill("ANSI31", scale=12)
hatch.paths.add_polyline_path([(0, 0), (W, 0), (W, H), (0, H)], is_closed=True, flags=1)
hatch.paths.add_polyline_path([(T, T), (W - T, T), (W - T, H - T), (T, H - T)], is_closed=True, flags=16)

# interior walls
for x0, y0, x1, y1 in [(700, T, 700 + 12, H - T), (T, 500, 700, 500 + 12), (700 + 12, 400, W - T, 400 + 12)]:
    wall_rect(x0, y0, x1, y1)

# doors: leaf + swing arc
def door(x, y, width, angle_start, layer="DOORS"):
    msp.add_arc((x, y), width, angle_start, angle_start + 90, dxfattribs={"layer": layer})
    import math
    a = math.radians(angle_start + 90)
    msp.add_line((x, y), (x + width * math.cos(a), y + width * math.sin(a)), dxfattribs={"layer": layer})

door(300, 500 + 12, 90, 0)
door(712, 600, 90, 270)
door(900, 400, 80, 90)
door(500, T, 100, 0)

# windows: three parallel lines across the wall
def window(x0, x1, y):
    for dy in (0, T / 2, T):
        msp.add_line((x0, y + dy), (x1, y + dy), dxfattribs={"layer": "WINDOWS"})

window(120, 300, H - T)
window(900, 1080, H - T)
window(850, 1050, 0)

# room names with areas (MTEXT, two lines)
rooms = [((350, 720), "LIVING ROOM\\P28.4 m²"), ((350, 250), "KITCHEN\\P21.9 m²"),
         ((950, 650), "BEDROOM\\P19.6 m²"), ((950, 200), "BATHROOM\\P11.8 m²")]
for (x, y), text in rooms:
    m = msp.add_mtext(text, dxfattribs={"layer": "ROOM-NAMES", "char_height": 22})
    m.set_location((x, y), attachment_point=5)

# furniture: a table with chairs as a block, inserted twice
blk = doc.blocks.new("TABLE_4")
blk.add_lwpolyline([(-60, -40), (60, -40), (60, 40), (-60, 40)], close=True)
for cx, cy in [(-35, -65), (35, -65), (-35, 65), (35, 65)]:
    blk.add_circle((cx, cy), 18)
msp.add_blockref("TABLE_4", (350, 250), dxfattribs={"layer": "FURNITURE"})
msp.add_blockref("TABLE_4", (350, 700), dxfattribs={"layer": "FURNITURE", "rotation": 90})
msp.add_lwpolyline([(860, 560), (1040, 560), (1040, 760), (860, 760)], close=True, dxfattribs={"layer": "FURNITURE"})

# electrical: sockets and ceiling lights
for x, y in [(60, 700), (650, 300), (1140, 620), (760, 120)]:
    msp.add_circle((x, y), 10, dxfattribs={"layer": "ELECTRICAL"})
    msp.add_line((x - 10, y), (x + 10, y), dxfattribs={"layer": "ELECTRICAL"})
for x, y in [(350, 700), (350, 250), (950, 650), (950, 200)]:
    msp.add_circle((x, y), 15, dxfattribs={"layer": "ELECTRICAL"})
    msp.add_line((x - 11, y - 11), (x + 11, y + 11), dxfattribs={"layer": "ELECTRICAL"})
    msp.add_line((x - 11, y + 11), (x + 11, y - 11), dxfattribs={"layer": "ELECTRICAL"})

# dimensions
for p1, p2, base in [((0, 0), (W, 0), (0, -80)), ((0, 0), (700, 0), (0, -40)), ((700, 0), (W, 0), (0, -40))]:
    msp.add_linear_dim(base=base, p1=p1, p2=p2, dimstyle="EZDXF", dxfattribs={"layer": "DIMENSIONS"}).render()
for p1, p2, base in [((W, 0), (W, H), (W + 80, 0)), ((W, 0), (W, 400), (W + 40, 0)), ((W, 400), (W, H), (W + 40, 0))]:
    msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=90, dimstyle="EZDXF", dxfattribs={"layer": "DIMENSIONS"}).render()

# title
msp.add_text("SAMPLE HOUSE · GROUND FLOOR · 1:100", height=30, dxfattribs={"layer": "ROOM-NAMES"}).set_placement((0, H + 80), align=TextEntityAlignment.LEFT)
msp.add_text("dwg.moonforge.tech", height=18, dxfattribs={"layer": "ROOM-NAMES", "color": 1}).set_placement((0, H + 45), align=TextEntityAlignment.LEFT)

# LibreDWG's DXF reader rejects group code 50 (rotation) on MTEXT, and ezdxf
# writes it for dimension text too. A direction vector means the same thing.
import math
for layout in [msp, *doc.blocks]:
    for m in layout.query("MTEXT"):
        if m.dxf.hasattr("rotation"):
            a = math.radians(m.dxf.rotation)
            m.dxf.text_direction = (math.cos(a), math.sin(a), 0)
            m.dxf.discard("rotation")

dxf = OUT / "sample-house.dxf"
doc.saveas(dxf)
print(dxf, dxf.stat().st_size)
