// Prepares everything the CAD engine loads at runtime, so the site never
// reaches out to a third-party host (the engine's defaults point at a CDN).
//
//   1. Patches known rendering bugs in the pinned @mlightcad packages.
//   2. Copies the DWG parser worker, its WASM and the MTEXT worker to public/cad/workers.
//   3. Writes public/cad/fonts: osifont (GPL-3.0 + font exception) standing in
//      (widened to AutoCAD text metrics) for every font name drawings commonly reference. The engine's default
//      font repository mirrors Autodesk SHX and Microsoft fonts that we have no
//      licence to redistribute, so we do not use it.
//
// Runs before `dev` and `build`. Every patch is idempotent and fails loudly when
// its pattern is gone, so a version bump cannot silently drop a fix.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patches } from './cad-patches.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nm = (p) => join(root, 'node_modules', p)
// Engine assets live under a content-hashed directory. They are fetched by URL
// at runtime (workers, WASM, fonts, template), so a fixed path plus a long
// cache lifetime meant a fixed rendering bug stayed live at Cloudflare's edge
// until the cache expired. A new hash is a new URL, so a deploy always wins.
let assetDir = 'cad'
let workerDir = 'cad/workers'
const pub = (p) => join(root, 'public', assetDir, p)
const pubWorker = (p) => join(root, 'public', workerDir, p)

// --- 1. patches --------------------------------------------------------------

for (const patch of patches) {
  for (const rel of patch.files) {
    const file = nm(rel)
    const src = readFileSync(file, 'utf8')
    if (src.includes(patch.done)) continue
    if (!patch.from.test(src)) {
      throw new Error(`prepare-cad: pattern for "${patch.name}" not found in ${rel}. The package changed; re-check the fix.`)
    }
    writeFileSync(file, src.replace(patch.from, patch.to))
    console.log(`prepare-cad: patched ${patch.name} (${rel})`)
  }
}

// --- 2. asset directory name ------------------------------------------------

const workerSources = [
  '@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js',
  '@mlightcad/libredwg-converter/dist/libredwg-web.wasm',
  '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'
]
const fontSource = join(root, 'vendor', 'osifont', 'osifont-dwg.woff')
const templateSource = join(root, 'templates', 'acadiso.dxf')
const fingerprint = createHash('sha256')
for (const file of [...workerSources.map(nm), fontSource, templateSource]) {
  fingerprint.update(readFileSync(file))
}

// --- 3. workers ----------------------------------------------------------------

rmSync(join(root, 'public', 'cad'), { recursive: true, force: true })
const hash = fingerprint.digest('hex').slice(0, 12)
assetDir = join('cad', hash)
// Workers keep the /cad/workers/ prefix so the Content-Security-Policy rule in
// public/_headers still matches them; the hash below busts the cache.
workerDir = join('cad', 'workers', hash)
mkdirSync(pubWorker('.'), { recursive: true })
for (const rel of workerSources) {
  copyFileSync(nm(rel), pubWorker(rel.split('/').pop()))
}

// --- 4. fonts --------------------------------------------------------------------

// Names as drawings reference them (text styles, SHX big fonts, the engine's own
// fallback chains). All of them resolve to osifont, an ISO 3098 technical
// lettering font, which is the look these SHX fonts approximate anyway.
const aliases = [
  'osifont',
  // AutoCAD SHX text fonts
  'txt', 'simplex', 'complex', 'italic', 'italicc', 'italict', 'romans', 'romanc', 'romand', 'romant',
  'monotxt', 'isocp', 'isocp2', 'isocp3', 'isoct', 'isoct2', 'isoct3', 'iso', 'geniso', 'geniso12',
  'gbenor', 'gbeitc', 'gothice', 'gothicg', 'gothici', 'scripts', 'scriptc', 'greekc', 'greeks',
  'times', 'timesout', 'bold', 'dim', 'simplex8', 'monotxt8', 'italic8', 'tssdeng', 'yjkeng',
  // symbol fonts used for %%c / %%d / %%p
  'amgdt', 'amgdtans', 'gdt', 'aigdt', 'gbgdt', 'special', 'symath', 'ltypeshp', 'genltshp',
  // big fonts and CJK fallbacks named in the engine's presets
  'gbcbig', 'hztxt', 'bigfont', 'extfont', 'extfont2', 'whgtxt', 'whgdtxt', 'chineset',
  'simsun', 'simhei', 'simkai', 'simfang', 'msyh', 'msgothic', 'malgun',
  // TrueType names common in European drawings
  'arial', 'arialn', 'arialbd', 'tahoma', 'verdana', 'calibri', 'calibril', 'calibrili', 'cambria',
  'segoeui', 'times new roman', 'timesnewroman', 'helvetica', 'isocpeur', 'isocteur', 'swiss', 'standard'
]
mkdirSync(pub('fonts'), { recursive: true })
// osifont-dwg.woff is osifont widened to AutoCAD's text metrics, see scripts/make_font.py.
copyFileSync(fontSource, pub('fonts/osifont-dwg.woff'))
writeFileSync(pub('fonts/fonts.json'), JSON.stringify([{ file: 'osifont-dwg.woff', name: aliases, type: 'mesh' }], null, 2) + '\n')

// --- 5. template -----------------------------------------------------------------

// The engine opens templates/acadiso.dxf when it starts; ours is an empty
// metric drawing generated by scripts/make_template.py, not Autodesk's file.
if (!existsSync(templateSource)) {
  throw new Error('prepare-cad: templates/acadiso.dxf is missing; run scripts/make_template.py')
}
mkdirSync(pub('templates'), { recursive: true })
copyFileSync(templateSource, pub('templates/acadiso.dxf'))

// --- 6. the path the viewer loads them from -------------------------------------

writeFileSync(
  join(root, 'src', 'viewer', 'cad-assets.ts'),
  `// Generated by scripts/prepare-cad.mjs. Do not edit.
export const CAD_BASE = '/${assetDir}/'
export const WORKER_BASE = '/${workerDir}/'
`
)

console.log(`prepare-cad: fonts and template under /${assetDir}/, workers under /${workerDir}/`)
