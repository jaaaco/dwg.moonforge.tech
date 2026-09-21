#!/usr/bin/env node
/**
 * Harvests search phrases about DWG and DXF from free, keyless sources and
 * files each one under a topic from seo/clusters.json.
 *
 * Ported from pdf.techsource.pro. The difference: phrases do not decide what
 * gets written (the curated topic map does); they feed the writer the words
 * people actually use for a topic, and the phrases that fit no topic are the
 * weekly hint for which topic to add next (rank-report shows them).
 *
 * Appends to content/keywords.jsonl; phrases already recorded are left alone.
 *
 *   node automation/keyword-harvest.mjs
 *   node automation/keyword-harvest.mjs --dry-run
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, argOf, hasFlag, log } from './lib.mjs'
import { loadSeo } from './content-lib.mjs'

const run = promisify(execFile)
const GIT = '/usr/bin/git'
const OUT = join(ROOT, 'content/keywords.jsonl')
const JOB = 'keyword-harvest'
const dryRun = hasFlag('dry-run')
const langFilter = argOf('lang', null)
const TODAY = process.env.HARVEST_DATE ?? new Date().toISOString().slice(0, 10)

/** Seeds name a job, not a product: that is how people with the problem type. */
const SEEDS = {
  en: [
    'open dwg', 'dwg viewer', 'dwg file', 'dwg to pdf', 'dxf viewer', 'dwg without autocad',
    'dwg on mac', 'dwg on iphone', 'measure dwg', 'print dwg', 'dwg version', 'dwg vs dxf',
  ],
  pl: [
    'plik dwg', 'otworzyć dwg', 'przeglądarka dwg', 'dwg na pdf', 'dwg bez autocada',
    'przeglądarka dxf', 'dwg na telefonie', 'wydruk dwg', 'jak otworzyć dwg', 'projekt dwg',
  ],
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) dwg.moonforge.tech-research' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

const googleSuggest = async (seed, lang) => {
  const [, suggestions] = await fetchJson(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${lang}&q=${encodeURIComponent(seed)}`)
  return suggestions ?? []
}
const duckSuggest = async (seed) => {
  const [, suggestions] = await fetchJson(`https://duckduckgo.com/ac/?q=${encodeURIComponent(seed)}&type=list`)
  return suggestions ?? []
}
/** Super User question titles: problems in full sentences. English only. */
const superUser = async (seed) => {
  const data = await fetchJson(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&pagesize=25&site=superuser&q=${encodeURIComponent(seed)}`)
  return (data.items ?? []).map((item) => item.title)
}

const clean = (phrase) => String(phrase).toLowerCase().replace(/\s+/g, ' ').replace(/[?!.]+$/, '').trim()

/** Not what this site is for: pirated software, other meanings of "DWG", downloads of specific drawings. */
const BLOCKED = /\b(crack|keygen|serial|torrent|apk|mod apk|machine|macchina|shoes|abbreviation|download (free )?(dwg|cad) (blocks?|files?)|blocks? free|cad blocks|free dwg blocks|bloki)\b/

const isUsable = (phrase) =>
  /\b(dwg|dxf)\b/.test(phrase) && phrase.length >= 8 && phrase.length <= 110 && phrase.split(' ').length >= 2 && !BLOCKED.test(phrase)

const seo = loadSeo()

/** First topic (map order) whose patterns match. Page and manual topics count: they are covered, not candidates. */
const clusterFor = (phrase, lang) => {
  for (const c of seo.clusters) {
    const side = c[lang]
    if (!side?.match) continue
    if (side.match.some((pattern) => new RegExp(pattern, 'i').test(phrase))) return c.key
  }
  return null
}

const seen = new Set()
if (existsSync(OUT)) {
  for (const line of (await readFile(OUT, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    try { seen.add(JSON.parse(line).phrase) } catch { /* skip a broken line */ }
  }
}

const collected = new Map()
const record = (phrase, lang, source) => {
  const p = clean(phrase)
  if (!isUsable(p) || seen.has(p) || collected.has(p)) return
  collected.set(p, { phrase: p, lang, source, cluster: clusterFor(p, lang), firstSeen: TODAY })
}

for (const lang of Object.keys(SEEDS).filter((l) => !langFilter || l === langFilter)) {
  for (const seed of SEEDS[lang]) {
    for (const variant of [seed, ...ALPHABET.map((letter) => `${seed} ${letter}`)]) {
      try {
        for (const s of await googleSuggest(variant, lang)) record(s, lang, 'google-suggest')
      } catch (error) {
        console.warn(`[harvest] google "${variant}": ${error.message}`)
      }
      await sleep(120)
    }
    try {
      for (const s of await duckSuggest(seed)) record(s, lang, 'duckduckgo')
    } catch (error) {
      console.warn(`[harvest] ddg "${seed}": ${error.message}`)
    }
    if (lang === 'en') {
      try {
        for (const t of await superUser(seed)) record(t, lang, 'superuser')
      } catch (error) {
        console.warn(`[harvest] superuser "${seed}": ${error.message}`)
      }
    }
    await sleep(400)
  }
}

const rows = [...collected.values()]
const unfiled = rows.filter((r) => !r.cluster).length

if (dryRun) {
  for (const r of rows) console.log(`${r.lang}  ${(r.cluster ?? '-').padEnd(26)} ${r.phrase}`)
  console.log(`\n[harvest] ${rows.length} new phrases, ${unfiled} fit no topic (dry run, nothing written)`)
  process.exit(0)
}

if (rows.length === 0) {
  await log(JOB, 'nothing new')
  process.exit(0)
}

await appendFile(OUT, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
await log(JOB, `+${rows.length} new phrases (${unfiled} fit no topic), ${seen.size + rows.length} total`)

// Commit the harvest right away. Left uncommitted it would make the tree
// dirty, and content-gen refuses to publish from a dirty tree (deploy.sh
// builds whatever is on disk). On the PDF site the uncommitted file was also
// thrown away by content-gen's cleanup after a failed build.
try {
  await run(GIT, ['add', 'content/keywords.jsonl'], { cwd: ROOT })
  await run(GIT, ['commit', '-m', `chore(keywords): +${rows.length} harvested phrases`, '--', 'content/keywords.jsonl'], { cwd: ROOT })
  await run(GIT, ['push', 'origin', 'main'], { cwd: ROOT })
} catch (error) {
  await log(JOB, `commit or push failed: ${error.message.slice(0, 300)}`)
}
