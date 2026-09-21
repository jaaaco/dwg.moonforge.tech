#!/usr/bin/env node
/**
 * Writes one guide, checks it, and publishes it to production.
 *
 * Ported from pdf.techsource.pro, with three differences that come from its
 * lessons and from publishing here being fully automatic:
 *
 *   - Topics come from a curated map (seo/clusters.json), not from regexes over
 *     harvested phrases. One page per intent is the map's structure, so the
 *     five-copies-of-one-article failure cannot happen, and the ceiling is
 *     visible instead of discovered.
 *   - It does not publish into a void. Before writing, it asks Search Console
 *     whether the home page is indexed; if Google does not know the site yet,
 *     a new page would land in "URL is unknown to Google" like the PDF site's
 *     did, so the run stops and says so. --skip-gate overrides it by hand.
 *   - The model writes only title, description, FAQ and text. Everything that
 *     makes a claim checkable (which facts, which sources, which cluster) is
 *     set by this script, and the draft is checked by content-lib.mjs.
 *
 * Polish first: for each topic the Polish page is written first and the
 * English one on the next run, with the Polish text as a reference.
 *
 *   node automation/content-gen.mjs --dry-run            # generate and check, write nothing
 *   node automation/content-gen.mjs                      # generate, check, commit, push, deploy
 *   node automation/content-gen.mjs --key=dwg-vs-dxf --lang=en --skip-gate
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT, argOf, hasFlag, log, notify } from './lib.mjs'
import { composeArticle, existingArticles, linkMenu, loadSeo, pickNext, validateDraft, GUIDE_BASE } from './content-lib.mjs'
import { inspectUrl, resolveSite } from './gsc.mjs'

const run = promisify(execFile)

const CLAUDE = process.env.CLAUDE_BIN ?? '/Users/jaaaco/.local/bin/claude'
const GIT = '/usr/bin/git'
const NPM = '/opt/homebrew/bin/npm'
const BASH = '/bin/bash'
const JOB = 'content-gen'

const dryRun = hasFlag('dry-run')
const skipGate = hasFlag('skip-gate')
const TODAY = process.env.CONTENT_DATE ?? new Date().toISOString().slice(0, 10)
const ATTEMPTS = 2

const seo = loadSeo()
const origin = seo.site.origin

/* --------------------------------------------------------------- preflight */

// deploy.sh builds the working tree, so anything uncommitted in it would go
// live with the article. A dirty tree means someone is working here: skip.
if (!dryRun) {
  const { stdout } = await run(GIT, ['status', '--porcelain'], { cwd: ROOT })
  if (stdout.trim()) {
    await log(JOB, `skipped: working tree not clean\n${stdout}`)
    await notify(`⏸️ dwg content-gen: pominięte, w repo są niezacommitowane zmiany\n${stdout.trim().split('\n').slice(0, 8).join('\n')}`)
    process.exit(0)
  }
  try {
    await run(GIT, ['pull', '--ff-only', 'origin', 'main'], { cwd: ROOT })
  } catch (error) {
    await log(JOB, `skipped: pull failed: ${error.message}`)
    await notify(`🔴 dwg content-gen: git pull --ff-only nie przeszedł, nic nie publikuję\n${error.message.slice(0, 300)}`)
    process.exit(1)
  }
}

/* -------------------------------------------------------------------- gate */

if (!skipGate && !dryRun) {
  let verdict
  try {
    const site = await resolveSite(seo.site.gscProperty)
    const result = await inspectUrl(site, `${origin}/`)
    verdict = result.indexStatusResult?.verdict ?? 'UNKNOWN'
    if (verdict !== 'PASS') {
      const state = result.indexStatusResult?.coverageState ?? verdict
      await log(JOB, `gate closed: home page not indexed (${state})`)
      await notify(
        `⏸️ dwg content-gen: strona główna nie jest w indeksie Google („${state}”). ` +
          'Nie publikuję w próżnię, najpierw linki przychodzące. Ręcznie: --skip-gate.',
      )
      process.exit(0)
    }
  } catch (error) {
    await log(JOB, `gate closed: ${error.message}`)
    await notify(`⏸️ dwg content-gen: bramka indeksacji nie odpowiada, nic nie publikuję\n${error.message.slice(0, 400)}`)
    process.exit(0)
  }
}

/* -------------------------------------------------------------------- pick */

const next = pickNext(seo, { key: argOf('key'), lang: argOf('lang') })
if (!next) {
  await log(JOB, 'every engine topic in seo/clusters.json has its pages; add clusters to keep going')
  await notify('🏁 dwg content-gen: wszystkie tematy z seo/clusters.json mają już strony. Czas dopisać nowe klastry (podpowiedzi w rank-report).')
  process.exit(0)
}

const { cluster, locale } = next
const side = cluster[locale]
const outPath = join(ROOT, 'content', locale, `${side.slug}.md`)
const url = `${origin}${GUIDE_BASE[locale]}/${side.slug}`
await log(JOB, `topic ${cluster.key} (${locale}), cluster ${cluster.cluster}`)

/* ------------------------------------------------------------------- brief */

const factLines = cluster.facts.map((id) => {
  const f = seo.facts[id]
  return `- ${locale === 'pl' ? f.claim_pl : f.claim}`
})
const measuredLines = seo.measured.map((m) => `- ${locale === 'pl' ? m.text_pl : m.text}`)
const menu = linkMenu(seo, locale)
const linkLines = menu.map((l) => `- ${l.path}  (${l.title}: ${l.note})`)

const harvested = (() => {
  const file = join(ROOT, 'content/keywords.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.cluster === cluster.key && row.lang === locale)
    .slice(0, 15)
    .map((row) => row.phrase)
})()

const counterpart = existingArticles().find((a) => a.key === cluster.key && a.locale !== locale)
const counterpartText = counterpart ? readFileSync(counterpart.file, 'utf8').slice(0, 9000) : null

const languageNote =
  locale === 'pl'
    ? `Write in Polish, the way a Polish engineer explains things to a smart friend: direct, calm, concrete, "po ludzku", no corporate or officialese tone. Keep English technical terms where Polish users actually say them (layout, viewport, xref). Mix short, decisive sentences with longer explaining ones. Use the imperative to guide ("Otwórz", "Kliknij", "Sprawdź"). Never use a dash as a pause (no "—" and no " – "): use a comma, colon, full stop or brackets.`
    : 'Write in English: plain, calm, concrete. Never use em dashes (—); use a comma, colon, full stop or brackets.'

const prompt = `You write one guide for dwg.moonforge.tech, a free, open-source (GPL-3.0) DWG and DXF viewer by Moonforge Labs that runs entirely in the browser: the file is read locally by GNU LibreDWG compiled to WebAssembly and is never uploaded. The site speaks as "we".

TOPIC: ${cluster.key}
Search phrase to answer: "${side.phrase}"
What the reader needs: ${cluster.angle}
${harvested.length ? `\nOther searches people type for this topic (answer the ones that fit, as sections or FAQ):\n${harvested.map((p) => `- ${p}`).join('\n')}\n` : ''}
${languageNote}

WHAT THE VIEWER CAN DO (as of ${seo.features.asOf}) - describe only these:
${seo.features.can.map((c) => `- ${c}`).join('\n')}

WHAT IT CANNOT DO - never suggest it can:
${seo.features.cannot.map((c) => `- ${c}`).join('\n')}

FACTS ABOUT OTHER PRODUCTS - the only ones you may state, and the only products you may name besides AutoCAD, DWG, DXF and this viewer. Sources are added under the article automatically; do not cite or link them.
${factLines.length ? factLines.join('\n') : '- none for this topic: do not name or describe any other viewer or CAD product'}

OUR OWN MEASUREMENTS - the only figures with a unit (%, s, ms, MB, KB, GB, minutes) you may use:
${measuredLines.join('\n')}

INTERNAL LINKS - link at least two of these, with natural anchor text, using exactly these paths. No other URLs, no external links:
${linkLines.join('\n')}

HARD RULES
- Never invent a number with a unit, a statistic, a price, a version requirement or a date. If you have no figure, describe it qualitatively.
- Never write that a subscription or licence is needed to view a drawing; viewing is free. Never write that DWG is not a trademark or that Autodesk invented DWG. No "up to N" phrasing. Never promise results identical to AutoCAD.
- Answer the reader's job early and concretely. If the honest answer is that this viewer cannot do something, say so and say what does, within the facts above.
- No filler, no "in today's world", no restating the title as the first sentence.
- Opinions are allowed only when labelled as opinion.

FORMAT - return the complete markdown file and nothing else, no preamble, no code fence around it:

---
title: <specific title, 30-65 characters, not just the search phrase>
description: <one or two sentences, 60-165 characters>
faq:
  - q: <a question a reader would ask>
    a: <a direct answer, 1-3 sentences>
  (3 to 5 items, not repeating the body word for word)
---

# <H1: the question or task, in the reader's words>

<body: 600-1100 words; ## headings (questions or plain statements, never slogans); short paragraphs; numbered steps where there is a procedure; a table if a comparison helps. Do not add a Sources, Questions or FAQ section in the body: those are rendered from the front matter.>
${counterpartText ? `\nThe ${counterpart.locale === 'pl' ? 'Polish' : 'English'} page for this topic is already published. Write the ${locale === 'pl' ? 'Polish' : 'English'} page for the same intent: same facts and structure are fine, but write it for this language's reader, not as a literal translation.\n\n<published-counterpart>\n${counterpartText}\n</published-counterpart>` : ''}`

/* ---------------------------------------------------------------- generate */

const generate = async (text) => {
  // --tools "" : this call wants a string on stdout and nothing else. With
  // tools the model also wrote files itself on the PDF site, which broke
  // --dry-run and left rejected drafts behind to steer the next run.
  const { stdout } = await run(CLAUDE, ['-p', text, '--tools', ''], { cwd: ROOT, maxBuffer: 10 * 1024 * 1024, timeout: 600000 })
  return stdout.trim()
}

let result = null
let lastReason = ''
for (let attempt = 1; attempt <= ATTEMPTS && !result; attempt++) {
  const text = attempt === 1
    ? prompt
    : `${prompt}\n\nYOUR PREVIOUS DRAFT WAS REJECTED by an automatic check: ${lastReason}\nWrite the whole file again and fix that.`
  let raw
  try {
    await log(JOB, `calling claude (attempt ${attempt})...`)
    raw = await generate(text)
  } catch (error) {
    await log(JOB, `claude failed: ${error.message}`)
    await notify(`🔴 dwg content-gen: claude nie odpowiedział (${cluster.key}, ${locale})\n${error.message.slice(0, 300)}`)
    process.exit(1)
  }
  const checked = validateDraft(raw, { seo, locale, cluster })
  if (checked.ok) result = checked
  else {
    lastReason = checked.reason
    await log(JOB, `attempt ${attempt} rejected: ${checked.reason}`)
  }
}

if (!result) {
  await notify(`🟡 dwg content-gen: odrzucone ${ATTEMPTS} szkice (${cluster.key}, ${locale})\nostatni powód: ${lastReason}`)
  process.exit(1)
}

const file = composeArticle({ cluster, locale, date: TODAY }, result.data, result.body)
await log(JOB, `draft ok: ${result.words} words, ${result.links} internal links`)

if (dryRun) {
  console.log(`\n${'-'.repeat(70)}\n${file}${'-'.repeat(70)}`)
  await log(JOB, 'dry run: nothing written')
  process.exit(0)
}

/* -------------------------------------------------------------------- ship */

await writeFile(outPath, file, 'utf8')
try {
  // The collection schema runs here too: a bad front matter fails the build.
  await run(NPM, ['run', 'build'], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 600000 })
} catch (error) {
  await unlink(outPath).catch(() => {})
  await log(JOB, `build failed, draft discarded: ${error.message.slice(0, 500)}`)
  await notify(`🔴 dwg content-gen: build nie przeszedł, szkic usunięty (${cluster.key}, ${locale})`)
  process.exit(1)
}

const rel = `content/${locale}/${side.slug}.md`
await run(GIT, ['add', rel], { cwd: ROOT })
await run(GIT, ['commit', '-m', `content(${locale}): ${result.data.title}\n\nTopic ${cluster.key} (${cluster.cluster}), generated and checked by automation/content-gen.mjs.\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`], { cwd: ROOT })
await run(GIT, ['push', 'origin', 'main'], { cwd: ROOT })

try {
  await run(BASH, [join(ROOT, 'deploy.sh')], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 900000 })
} catch (error) {
  await log(JOB, `deploy failed: ${error.message.slice(0, 500)}`)
  await notify(`🔴 dwg content-gen: artykuł zacommitowany, ale deploy padł. Odpal ./deploy.sh ręcznie.\n${url}`)
  process.exit(1)
}

await log(JOB, `published ${url}`)
await notify(
  `📝 dwg.moonforge.tech: nowy ${locale === 'pl' ? 'poradnik' : 'guide'}\n\n${result.data.title}\n${url}\n\n` +
    `${result.words} słów, temat ${cluster.key}\nWycofanie: node automation/unpublish.mjs --lang=${locale} --slug=${side.slug}`,
)
