"""Write public/cad/templates/acadiso.dxf, the empty drawing the CAD engine opens at start-up.

The engine looks for a file of that name; its default is Autodesk's template
fetched from a CDN. This one is ours: a blank metric (ISO) drawing from ezdxf.

    python3 scripts/make_template.py   (needs: pip install ezdxf)
"""
from pathlib import Path

import ezdxf

out = Path(__file__).resolve().parent.parent / "public" / "cad" / "templates" / "acadiso.dxf"
out.parent.mkdir(parents=True, exist_ok=True)
doc = ezdxf.new("R2018", setup=True, units=4)  # millimetres
doc.header["$MEASUREMENT"] = 1  # metric
doc.saveas(out)
print(out, out.stat().st_size)
