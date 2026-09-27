// The fixes we carry for the pinned @mlightcad packages, as data.
//
// Kept apart from prepare-cad.mjs so scripts/check-upstream.mjs can ask the
// same question about the latest published versions: is this bug still there,
// and is the patch therefore still ours to maintain (or to send upstream)?
//
// Each entry: `from` is the code as published, `to` is our replacement, `done`
// is the marker that makes re-running a no-op. prepare-cad.mjs fails loudly
// when `from` no longer matches, so a version bump cannot silently drop a fix.
//
// Upstream status lives in `upstream` and is what a future session should read
// before re-investigating anything: `issue` / `pr` links, or a short note.

export const patches = [
  {
    // Paragraph tab stops: `\pi0,l0,tz;` (AutoCAD writes `tz` to clear them).
    // "z" is neither r/c nor a number, and the loop consumed nothing for it, so
    // it pushed zeros forever. Chrome ground through it in seconds; WebKit hung
    // the MTEXT worker for good, and every text queued behind it stayed blank
    // with the spinner up (reported on Safari, reproduced in WebKit).
    upstream: { issue: 'https://github.com/mlightcad/mtext-parser/issues/8', pr: 'https://github.com/mlightcad/mtext-parser/pull/10', state: 'PR open 2026-09-27, awaiting maintainer. Independently confirmed by @zdendael from the Chromium side.' },
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
    upstream: { issue: 'https://github.com/mlightcad/mtext-parser/issues/8', pr: 'https://github.com/mlightcad/mtext-parser/pull/10', state: 'Same fix as above; these two packages bundle their own copy of the parser. mtext-renderer 0.13.0 no longer matches (checked 2026-09-27), cad-simple-viewer 1.7.1 still does, because it bundles an older renderer.' },
    name: 'mtext parser (bundled copies): tab stop list cannot loop forever',
    files: ['@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js', '@mlightcad/mtext-renderer/dist/index.js'],
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
    upstream: { repo: 'https://github.com/mlightcad/mtext-renderer', state: 'NOT reported, and not a slip upstream: the source adds it deliberately (obliqueExtraAdvance, documented, fed into penAdvance). Our claim is that AutoCAD shears glyphs without advancing the pen, which is why our lines overflowed their own MTEXT box. That is an issue with a measured repro drawing, not a drive-by PR, so it needs the box width and the rendered width side by side before it is worth anyone reading (source checked 2026-09-27).' },
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
    upstream: { repo: 'https://github.com/mlightcad/mtext-renderer', state: 'Do NOT report as new: mtext-renderer 0.13.0 no longer matches this pattern (checked 2026-09-27), so upstream reworked it, apparently in the same direction (_lineHasRenderableChar now exists there). Next step is not a bug report but an upgrade: bump the pin to 0.13.0, render the wrap test drawings, and drop this patch if it holds.' },
    name: 'mtext: wrap lines at word boundaries',
    files: ['@mlightcad/mtext-renderer/dist/index.js', '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'],
    from: /\(this\._vOffset <= 0 && this\._currentLineObjects\.length <= 0 \|\| \(this\.recordVisualLineBreak\((\w+), (\w+)\), this\.advanceToNextLine\(!1\)\)\);/,
    to: '(!this._lineHasRenderableChar /* dwg.moonforge.tech: word wrap */ || (this.recordVisualLineBreak($1, $2), this.advanceToNextLine(!1)));',
    done: '/* dwg.moonforge.tech: word wrap */'
  },
  {
    // With words wrapped as a whole above, the per-character break only ever
    // split words. AutoCAD lets an over-long word run past the box instead.
    upstream: { repo: 'https://github.com/mlightcad/mtext-renderer', state: 'Companion to the wrap fix above, same story: gone from mtext-renderer 0.13.0 (checked 2026-09-27). Re-test after the upgrade instead of reporting. If 0.13.0 still splits over-long words, that is an issue about behaviour (AutoCAD lets such a word run past the box), not a bug report.' },
    name: 'mtext: no mid-word line breaks',
    files: ['@mlightcad/mtext-renderer/dist/index.js', '@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'],
    from: /this\._lineHasRenderableChar \|\| this\.applyPendingEmptyLineYAdjust\(\), this\.hOffset > \(this\.maxLineWidth \|\| 1 \/ 0\) && \(this\.recordVisualLineBreak\(\w+, \w+\), this\.advanceToNextLine\(!1\)\);/,
    to: 'this._lineHasRenderableChar || this.applyPendingEmptyLineYAdjust(); /* dwg.moonforge.tech: no mid-word break */',
    done: '/* dwg.moonforge.tech: no mid-word break */'
  },
  {
    // %%d tried code 126 first, which is "~" in every text font; 176 is the
    // degree sign. 126 stays as the fallback for amgdt-style symbol fonts.
    upstream: { repo: 'https://github.com/mlightcad/mtext-renderer', state: 'DO NOT report: this one is ours. Upstream looks the codes up in symbol fonts only (getCodeShapeFromSymbolFonts) and falls back to the Unicode character when there is none, which is correct. We see a tilde because prepare-cad aliases the symbol font names (amgdt, gdt, aigdt...) to osifont, so byte 126 resolves in a text font. The real fix is to stop aliasing symbol fonts and drop this patch (checked in the source 2026-09-27).' },
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
    upstream: { repo: 'https://github.com/mlightcad/realdwg-web', state: 'NOT reported, READY TO SEND, and the only one of these that is clean. Confirmed against published packages 2026-09-27: libredwg-converter 3.14.14 still does contents = mtext.text, and mtext-parser 1.5.2 given "GR. 1,5 mm\\nTEST" yields GR. / 1,5 / NEW_PARAGRAPH / TEST. The word before the break is dropped, not just unsplit. Fix belongs in the converter (emit \\P), and the parser silently losing a word is worth mentioning in the same report. The package lives in the realdwg-web monorepo.' },
    name: 'converter: MTEXT newlines become \\P',
    files: ['@mlightcad/libredwg-converter/lib/AcDbEntitiyConverter.js'],
    from: /dbEntity\.contents = mtext\.text;/,
    to: "dbEntity.contents = typeof mtext.text === 'string' ? mtext.text.replace(/\\r?\\n/g, '\\\\P').replace(/\\t/g, ' ') : mtext.text; /* dwg.moonforge.tech */",
    done: '/* dwg.moonforge.tech */'
  }
]
