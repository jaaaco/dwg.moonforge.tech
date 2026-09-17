# dwg.moonforge.tech

A free, open-source DWG and DXF viewer that runs entirely in the browser. The drawing is decoded by
[GNU LibreDWG](https://www.gnu.org/software/libredwg/) compiled to WebAssembly and drawn with WebGL.
No upload, no account, no server that ever sees a file.

Why it exists: [/why](https://dwg.moonforge.tech/why) · po polsku: [/pl/dlaczego](https://dwg.moonforge.tech/pl/dlaczego)

## Run it

```bash
npm install
npm run dev        # http://localhost:4321 (Astro picks the next free port if taken)
npm run build      # static site in dist/
```

`predev` and `prebuild` run `scripts/prepare-cad.mjs`, which prepares everything the CAD engine loads at
runtime (see below). Node 20+.

## How it fits together

| Part | Where |
|---|---|
| Pages (EN at `/`, PL at `/pl`), one per search intent, static HTML | `src/pages/`, strings and routes in `src/lib/i18n.ts` |
| Layout: title, canonical, hreflang, Open Graph, JSON-LD | `src/layouts/Base.astro` |
| Viewer UI (open, drop, layers, status) | `src/components/Viewer.astro`, `src/viewer/app.ts` |
| CAD engine, loaded only when a file is opened | `src/viewer/engine.ts` |
| Engine runtime assets: workers, WASM, fonts, template | `public/cad/`, produced by `scripts/prepare-cad.mjs` |
| Sitemap with hreflang pairs | `src/pages/sitemap.xml.ts` |
| Security headers, caching, per-worker CSP | `public/_headers` (Cloudflare Pages) |

The engine is [mlightcad](https://github.com/mlightcad/cad-viewer) (`@mlightcad/cad-simple-viewer`, MIT) with
`@mlightcad/libredwg-converter` (GPL-3.0) for DWG. Versions are pinned exactly: the packages release every
few days.

### What `scripts/prepare-cad.mjs` does, and why

1. **Patches four rendering bugs** in the pinned mlightcad packages (text wrapping, oblique text width, the
   degree sign, MTEXT line breaks from LibreDWG). Each patch is idempotent and the script fails if a pattern is
   gone, so upgrading a package cannot silently drop a fix. Details are in the comments next to each patch.
2. **Copies the workers and WASM** into `public/cad/workers/`.
3. **Publishes our own font catalogue.** The engine's default font repository mirrors AutoCAD SHX and Microsoft
   fonts that nobody may redistribute. Instead every common font name maps to
   [osifont](https://github.com/hikikomori82/osifont) (GPL-3.0 with font exception), widened 15% to AutoCAD's
   text metrics by `scripts/make_font.py` so text wraps where the drawing's author saw it wrap.
4. Checks that `public/cad/templates/acadiso.dxf` exists: our blank template from `scripts/make_template.py`,
   instead of the engine fetching Autodesk's from a CDN.

The result: opening a drawing makes no request to any host but this one. The end-to-end check below verifies
that.

### Content Security Policy

Pages run under a strict CSP. The DWG parser is Emscripten output and needs `eval`, so `/cad/workers/*` gets
its own policy with `'unsafe-eval'` (a worker runs under the CSP of its own script response).

## Testing

There is no test suite yet. What was verified by hand before the first release:

- `npx wrangler pages dev dist` (run from a copy of `dist/` outside the project, see Deploy): every route
  returns 200, unknown URLs 404, `.html` URLs redirect to clean ones, headers as in `public/_headers`.
- Headless Chrome against that server: the sample DXF and a real 2.6 MB DWG 2004 detail drawing open on desktop
  and a 390 px phone viewport, with zero console errors and zero requests to other origins.

## Deploy

Cloudflare Pages, project `dwg-moonforge-tech`, custom domain `dwg.moonforge.tech` (DNS zone on Cloudflare).
Run wrangler from a temporary directory: started inside a Vite project it rewrites the project's config.

```bash
./deploy.sh                      # production
DEPLOY_BRANCH=test ./deploy.sh   # preview at test.dwg-moonforge-tech.pages.dev
```

## Licence

GPL-3.0-or-later, see [LICENSE](LICENSE). Component licences are listed on
[/licenses](https://dwg.moonforge.tech/licenses).

Not affiliated with or endorsed by Autodesk. AutoCAD and DWG are trademarks of Autodesk, Inc.

Made by [Moonforge Labs](https://moonforge.tech).
