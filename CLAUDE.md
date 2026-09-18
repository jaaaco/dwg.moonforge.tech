# CLAUDE.md

Free, open-source (GPL-3.0) DWG/DXF viewer that runs entirely in the browser. Read `README.md` first: it
explains the engine, the patches and why the site never calls a third-party host.

## Rules that are easy to break

- **No request may leave the origin.** No CDN fonts, no analytics scripts (the privacy page says so),
  no engine defaults pointing at jsdelivr. The privacy promise on every page depends on it. After any change to
  the viewer, open a DWG in headless Chrome and check the request log.
- **Never publish AutoCAD SHX, Microsoft or other non-free fonts or templates**, even though the engine's own
  font repository mirrors them. Text uses `vendor/osifont/osifont-dwg.woff`.
- **Keep mlightcad versions exact.** When upgrading, run `npm run prepare-cad`: it fails if a patch no longer
  applies. Re-check each fix against the new code before deleting a patch.
- **Every claim about Autodesk needs a primary source and a check date** on the page. Say "subscription only",
  "Windows only", "requires an account and upload" where Autodesk's pages say so. Do not write that a
  subscription is needed to view a drawing (DWG TrueView and Autodesk Viewer are free), that DWG is not a
  trademark, or that Autodesk invented DWG. Opinion is allowed and labelled as opinion.
- **One page per search intent, EN and PL.** Add routes in `src/lib/i18n.ts`; the sitemap and hreflang follow.
  A page without a real counterpart in the other language gets `null`, not a thin translation.
- **The PDF export and measuring read renderer internals** (`_geometryInfo`, batch draw ranges, hatch and
  linetype shader uniforms, the layout view's camera). After any mlightcad upgrade, plot a real drawing and
  compare it with the screen: missing hatches, solid-looking dashed lines or misplaced text mean the shapes
  moved. Then measure a line whose length you know from the database — the reading has to match exactly.
  Details in `README.md` under "Plotting to PDF" and "Measuring".
- **Never present a measurement as more certain than the file.** `INSUNITS` is wrong in most drawings we have
  seen, so the unit is offered, not asserted: the reading shows the file's unit and lets the reader change it.
- Prose in Polish follows the owner's style: direct, no em dashes.

## Handy

```bash
npm run dev                 # dev server
npm run build               # static build, runs prepare-cad first
python3 scripts/make_font.py      # rebuild the widened osifont (fonttools)
python3 scripts/make_sample.py    # rebuild the sample DXF (ezdxf)
python3 scripts/make_template.py  # rebuild the blank template (ezdxf)
```
