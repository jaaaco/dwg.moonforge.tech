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
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nm = (p) => join(root, 'node_modules', p)
const pub = (p) => join(root, 'public', 'cad', p)

// --- 1. patches --------------------------------------------------------------

const patches = [
  {
    // Paragraph tab stops: `\pi0,l0,tz;` (AutoCAD writes `tz` to clear them).
    // "z" is neither r/c nor a number, and the loop consumed nothing for it, so
    // it pushed zeros forever. Chrome ground through it in seconds; WebKit hung
    // the MTEXT worker for good, and every text queued behind it stayed blank
    // with the spinner up (reported on Safari, reproduced in WebKit).
    name: 'mtext parser: tab stop list cannot loop forever',
    files: ['@mlightcad/mtext-parser/dist/parser.js'],
    from: /const value = parseFloatValue\(\);\s*\n\s*if \(!isNaN\(value\)\) \{\s*\n\s*tabStops\.push\(value\);\s*\n\s*\}\s*\n\s*else \{\s*\n\s*scanner\.consume\(1\);\s*\n\s*\}/,
    to: `const __dwgRest = scanner.tail.length;
                            const value = parseFloatValue();
                            if (scanner.tail.length === __dwgRest) {
                                scanner.consume(1); /* dwg.moonforge.tech: no number here, skip the character */
                            }
                            else if (!isNaN(value)) {
                                tabStops.push(value);
                            }`,
    done: 'dwg.moonforge.tech: no number here'
  },
  {
    name: 'mtext parser (worker bundle): tab stop list cannot loop forever',
    files: ['@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'],
    from: /\} else \{\s*\n\s*const (\w+) = (\w+)\(\);\s*\n\s*isNaN\(\1\) \? (\w+)\.consume\(1\) : (\w+)\.push\(\1\);\s*\n\s*\}/,
    to: `} else {
              const __dwgRest = $3.tail.length, $1 = $2();
              $3.tail.length === __dwgRest ? $3.consume(1) : isNaN($1) || $4.push($1); /* dwg.moonforge.tech: tab stop cannot loop */
            }`,
    done: 'dwg.moonforge.tech: tab stop cannot loop'
  },
  {
    // Obliqued text (text styles at 15 degrees are common) got an extra advance
    // of tan(angle) * height after every glyph, about a quarter of the text
    // height per character. AutoCAD shears glyphs without moving the pen, so
    // lines came out far wider than their MTEXT box and ran into each other.
    name: 'mtext: oblique shear does not widen text',
    files: ['@mlightcad/mtext-renderer/dist/index.js', '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'],
    from: /\), (\w+) = Math\.tan\((\w+)\) \* (\w+);/,
    to: '), $1 = 0 /* dwg.moonforge.tech: shear does not advance */;',
    done: '/* dwg.moonforge.tech: shear does not advance */'
  },
  {
    // Word wrap never fired: processWord() only broke a line when
    // `_vOffset <= 0 && _currentLineObjects.length <= 0` was false, but line
    // objects are flushed at the end of a line and _vOffset goes negative
    // downwards, so the guard was always true. All wrapping then fell to the
    // per-character check below, which splits words ("OBWODO / WA"). The guard
    // is meant to keep a word that is wider than the box on an empty line.
    name: 'mtext: wrap lines at word boundaries',
    files: ['@mlightcad/mtext-renderer/dist/index.js', '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'],
    from: /\(this\._vOffset <= 0 && this\._currentLineObjects\.length <= 0 \|\| \(this\.recordVisualLineBreak\((\w+), (\w+)\), this\.advanceToNextLine\(!1\)\)\);/,
    to: '(!this._lineHasRenderableChar /* dwg.moonforge.tech: word wrap */ || (this.recordVisualLineBreak($1, $2), this.advanceToNextLine(!1)));',
    done: '/* dwg.moonforge.tech: word wrap */'
  },
  {
    // With words wrapped as a whole above, the per-character break only ever
    // split words. AutoCAD lets an over-long word run past the box instead.
    name: 'mtext: no mid-word line breaks',
    files: ['@mlightcad/mtext-renderer/dist/index.js', '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'],
    from: /this\._lineHasRenderableChar \|\| this\.applyPendingEmptyLineYAdjust\(\), this\.hOffset > \(this\.maxLineWidth \|\| 1 \/ 0\) && \(this\.recordVisualLineBreak\(\w+, \w+\), this\.advanceToNextLine\(!1\)\);/,
    to: 'this._lineHasRenderableChar || this.applyPendingEmptyLineYAdjust(); /* dwg.moonforge.tech: no mid-word break */',
    done: '/* dwg.moonforge.tech: no mid-word break */'
  },
  {
    // %%d tried code 126 first, which is "~" in every text font; 176 is the
    // degree sign. 126 stays as the fallback for amgdt-style symbol fonts.
    name: 'mtext: %%d renders a degree sign',
    files: ['@mlightcad/mtext-renderer/dist/index.js', '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'],
    from: /d: \[126, 176\]/,
    to: 'd: [176, 126] /* dwg.moonforge.tech */',
    done: 'd: [176, 126] /* dwg.moonforge.tech */'
  },
  {
    // LibreDWG hands MTEXT line breaks over as raw "\n" (and keeps tabs), which
    // the MTEXT parser does not treat as a paragraph break: the word before the
    // newline disappeared ("GR. 1,5 mm" rendered as "GR. 1,5").
    name: 'converter: MTEXT newlines become \\P',
    files: ['@mlightcad/libredwg-converter/lib/AcDbEntitiyConverter.js'],
    from: /dbEntity\.contents = mtext\.text;/,
    to: "dbEntity.contents = typeof mtext.text === 'string' ? mtext.text.replace(/\\r?\\n/g, '\\\\P').replace(/\\t/g, ' ') : mtext.text; /* dwg.moonforge.tech */",
    done: '/* dwg.moonforge.tech */'
  }
]

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

// --- 2. workers ----------------------------------------------------------------

mkdirSync(pub('workers'), { recursive: true })
for (const rel of [
  '@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js',
  '@mlightcad/libredwg-converter/dist/libredwg-web.wasm',
  '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'
]) {
  copyFileSync(nm(rel), pub(join('workers', rel.split('/').pop())))
}

// --- 3. fonts --------------------------------------------------------------------

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
copyFileSync(join(root, 'vendor', 'osifont', 'osifont-dwg.woff'), pub('fonts/osifont-dwg.woff'))
writeFileSync(pub('fonts/fonts.json'), JSON.stringify([{ file: 'osifont-dwg.woff', name: aliases, type: 'mesh' }], null, 2) + '\n')

// --- 4. template -----------------------------------------------------------------

// The engine opens templates/acadiso.dxf when it starts; ours is an empty
// metric drawing generated by scripts/make_template.py, not Autodesk's file.
if (!existsSync(pub('templates/acadiso.dxf'))) {
  throw new Error('prepare-cad: public/cad/templates/acadiso.dxf is missing; run scripts/make_template.py')
}

console.log('prepare-cad: workers, fonts and template ready')
