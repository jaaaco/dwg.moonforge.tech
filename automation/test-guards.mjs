#!/usr/bin/env node
/**
 * Runs the draft checks from content-lib.mjs on hand-made drafts: one good
 * draft, and one broken copy per rule. With publishing fully automatic, a
 * guard that silently stopped working would mean the next bad draft goes
 * live. Run after touching content-lib.mjs or anything in seo/.
 *
 *   node automation/test-guards.mjs
 */

import { loadSeo, validateDraft } from './content-lib.mjs'

const seo = loadSeo()
const cluster = seo.clusters.find((c) => c.key === 'need-autocad')

const paragraphPl =
  'Otwórz plik w przeglądarce i sprawdź, co jest na rysunku. Nie musisz niczego instalować ani zakładać konta. ' +
  'Rysunek czyta Twoja karta przeglądarki, więc plik zostaje na Twoim komputerze. Przesuwaj widok przeciąganiem, powiększaj kółkiem. ' +
  'Warstwy włączasz i wyłączasz w panelu obok, a pomiar przyciąga się do końców linii. '
const paragraphEn =
  'Open the file in your browser and look at the drawing. You do not need to install anything or create an account. ' +
  'The drawing is read by your browser tab, so the file stays on your computer. Drag to pan and scroll to zoom. ' +
  'Layers switch on and off in the side panel, and measuring snaps to line ends. '

const draft = ({ locale = 'pl', title, description, faq, body }) => `---
title: "${title ?? (locale === 'pl' ? 'Czy do pliku DWG potrzebny jest AutoCAD? Krótko: nie' : 'Do you need AutoCAD to open a DWG file? No')}"
description: "${description ?? (locale === 'pl' ? 'Oglądanie rysunku DWG jest darmowe. Pokazujemy, czym otworzyć plik bez AutoCADa na komputerze i telefonie oraz kiedy potrzebny jest program CAD.' : 'Viewing a DWG is free. What to open it with on a computer or a phone without AutoCAD, and when you do need a CAD program.')}"
faq:
${(faq ?? [['Pytanie pierwsze?', 'Odpowiedź pierwsza.'], ['Pytanie drugie?', 'Odpowiedź druga.'], ['Pytanie trzecie?', 'Odpowiedź trzecia.']]).map(([q, a]) => `  - q: "${q}"\n    a: "${a}"`).join('\n')}
---

${body ?? (locale === 'pl'
  ? `# Czy potrzebuję AutoCADa, żeby otworzyć plik DWG?\n\nNie. [Otwórz go w przeglądarce](/pl) i gotowe. Szczegóły w poradniku [jak otworzyć plik DWG bez AutoCADa](/pl/jak-otworzyc-plik-dwg).\n\n## Jak to zrobić?\n\n${paragraphPl.repeat(12)}`
  : `# Do I need AutoCAD to open a DWG file?\n\nNo. [Open it in your browser](/) and that is it. Details in [how to open a DWG file without AutoCAD](/open-dwg-without-autocad).\n\n## How?\n\n${paragraphEn.repeat(12)}`)}
`

const cases = [
  ['valid Polish draft', draft({}), true],
  ['valid English draft', draft({ locale: 'en' }), true, 'en'],
  ['em dash', draft({ body: `# Czy potrzebuję AutoCADa?\n\nNie — [otwórz go](/pl) albo [poradnik](/pl/jak-otworzyc-plik-dwg).\n\n${paragraphPl.repeat(12)}` }), false],
  ['external URL', draft({ body: `# Czy potrzebuję AutoCADa?\n\nZobacz https://example.com oraz [to](/pl) i [to](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), false],
  ['link to a page that does not exist', draft({ body: `# Czy potrzebuję AutoCADa?\n\n[Otwórz](/pl) albo [nieistniejący](/pl/poradniki/nie-ma-takiego).\n\n${paragraphPl.repeat(12)}` }), false],
  ['English link in a Polish article', draft({ body: `# Czy potrzebuję AutoCADa?\n\n[Otwórz](/pl) albo [to](/dwg-to-pdf).\n\n${paragraphPl.repeat(12)}` }), false],
  ['invented figure', draft({ body: `# Czy potrzebuję AutoCADa?\n\nPlik otworzy się w 5 s. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), false],
  ['measured figure is fine', draft({ body: `# Czy potrzebuję AutoCADa?\n\nDetal 2,6 MB otworzył się w 3,4 s. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), true],
  ['subscription needed to view', draft({ body: `# Czy potrzebuję AutoCADa?\n\nPotrzebujesz subskrypcji, żeby otworzyć rysunek. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), false],
  ['negated licence claim is fine', draft({ body: `# Czy potrzebuję AutoCADa?\n\nNie potrzebujesz licencji, żeby otworzyć rysunek. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), true],
  ['up to N', draft({ body: `# Czy potrzebuję AutoCADa?\n\nOtwiera aż do 10 plików. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), false],
  ['product without a fact', draft({ body: `# Czy potrzebuję AutoCADa?\n\nMożesz też użyć ShareCAD. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), false],
  ['product with a fact is fine', draft({ body: `# Czy potrzebuję AutoCADa?\n\nDWG TrueView działa tylko na Windowsie. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), true],
  ['promises editing', draft({ body: `# Czy potrzebuję AutoCADa?\n\nW przeglądarce możesz edytować rysunek. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), false],
  ['negated editing is fine', draft({ body: `# Czy potrzebuję AutoCADa?\n\nPrzeglądarka nie pozwala edytować rysunku. [Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n${paragraphPl.repeat(12)}` }), true],
  ['promises DXF export', draft({ locale: 'en', body: `# Do I need AutoCAD?\n\nYou can export the drawing to DXF here. [Open](/), [guide](/dwg-to-pdf).\n\n${paragraphEn.repeat(12)}` }), false, 'en'],
  ['two H1 headings', draft({ body: `# Pierwszy\n\n[Otwórz](/pl), [poradnik](/pl/dwg-na-pdf).\n\n# Drugi\n\n${paragraphPl.repeat(12)}` }), false],
  ['too short', draft({ body: `# Krótko\n\n[Otwórz](/pl), [poradnik](/pl/dwg-na-pdf). ${paragraphPl}` }), false],
  ['English in a Polish slot', draft({ body: `# Do I need AutoCAD?\n\n[Open](/pl), [guide](/pl/dwg-na-pdf).\n\n${paragraphEn.repeat(12)}`, title: 'Do you need AutoCAD to open a DWG file? No', description: 'Viewing a DWG is free. What to open it with on a computer or a phone without AutoCAD, and when you need CAD.', faq: [['Q one?', 'A one.'], ['Q two?', 'A two.']] }), false],
  ['title too long', draft({ title: 'Czy potrzebuję AutoCADa, żeby otworzyć plik DWG na komputerze albo na telefonie?' }), false],
  ['missing front matter', `# Tylko treść\n\n${paragraphPl.repeat(12)}`, false],
]

let failed = 0
for (const [name, text, expectOk, locale = 'pl'] of cases) {
  const result = validateDraft(text, { seo, locale, cluster })
  const pass = result.ok === expectOk
  if (!pass) failed++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${result.ok ? '' : `  -> ${result.reason}`}`)
}
console.log(failed ? `\n${failed} of ${cases.length} checks did not behave` : `\nall ${cases.length} checks behave`)
process.exit(failed ? 1 : 0)
