#!/usr/bin/env node
/**
 * Re-reads the source of every fact in seo/facts.json and checks that the
 * quoted sentences are still there. Monthly.
 *
 * Why it exists: on 2026-09-21 the live guide still said LibreCAD's DWG
 * support was "rudimentary", quoting a README that had been rewritten three
 * days earlier. Nothing noticed. Facts about other products go stale on their
 * own schedule, and with articles published automatically the site repeats a
 * stale fact on every page that uses it.
 *
 * Outcomes per fact:
 *   - every quote found     -> `checked` moves to today (the page's "Sources
 *                              checked on" date follows after the deploy)
 *   - a quote missing (200) -> flagged on Telegram with the pages that use it;
 *                              nothing is changed or taken down automatically
 *   - source unreachable    -> unknown, left alone (Autodesk's CDN answers 403
 *                              to scripted clients now and then; that is not
 *                              evidence that the page changed)
 *
 * Autodesk pages need a real browser (plain fetches get 403 from Akamai), and
 * a fresh one per URL: a second request from the same session was refused.
 *
 *   node automation/facts-check.mjs             # check, update dates, commit and deploy if dates moved
 *   node automation/facts-check.mjs --dry-run   # report only
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync } from 'node:fs'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { ROOT, hasFlag, log, notify } from './lib.mjs'

const run = promisify(execFile)
const JOB = 'facts-check'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PDFTOTEXT = '/opt/homebrew/bin/pdftotext'
const GIT = '/usr/bin/git'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const dryRun = hasFlag('dry-run')
const TODAY = new Date().toISOString().slice(0, 10)

const FACTS = join(ROOT, 'seo/facts.json')
const facts = JSON.parse(readFileSync(FACTS, 'utf8'))
const norm = (s) => s.replace(/\s+/g, ' ').trim()

const viaBrowser = async (url) => {
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME })
  try {
    const page = await browser.newPage()
    await page.setUserAgent(UA)
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
    return { status: response?.status() ?? 0, text: await page.evaluate(() => document.body.innerText) }
  } finally {
    await browser.close()
  }
}

const viaPdf = async (url) => {
  const dir = await mkdtemp(join(tmpdir(), 'facts-'))
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) return { status: response.status, text: '' }
    await writeFile(join(dir, 'source.pdf'), Buffer.from(await response.arrayBuffer()))
    await run(PDFTOTEXT, [join(dir, 'source.pdf'), join(dir, 'source.txt')])
    return { status: 200, text: readFileSync(join(dir, 'source.txt'), 'utf8') }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const viaFetch = async (url) => {
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
  return { status: response.status, text: response.ok ? await response.text() : '' }
}

/** Which pages rely on a fact: articles through `facts`, hand-written pages through the source URL. */
const usersOf = (id, url) => {
  const hits = []
  for (const locale of ['en', 'pl']) {
    const dir = join(ROOT, 'content', locale)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const head = readFileSync(join(dir, f), 'utf8').split('\n---')[0]
      if (head.includes(id)) hits.push(`content/${locale}/${f}`)
    }
  }
  const pagesDir = join(ROOT, 'src/pages')
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  for (const f of walk(pagesDir).filter((x) => x.endsWith('.astro'))) {
    if (readFileSync(f, 'utf8').includes(url)) hits.push(f.replace(`${ROOT}/`, ''))
  }
  return hits
}

// One fetch per source, however many facts cite it.
const bySource = new Map()
for (const [id, f] of Object.entries(facts)) {
  if (id.startsWith('_')) continue
  const target = f.sourceText ?? f.source.url
  if (!bySource.has(target)) bySource.set(target, { kind: f.sourceText ? 'text' : f.sourceType === 'pdf' ? 'pdf' : 'browser', ids: [] })
  bySource.get(target).ids.push(id)
}

const confirmed = []
const missing = []
const unknown = []

for (const [target, { kind, ids }] of bySource) {
  let got
  try {
    got = kind === 'pdf' ? await viaPdf(target) : kind === 'text' ? await viaFetch(target) : await viaBrowser(target)
  } catch (error) {
    got = { status: 0, text: '', error: error.message }
  }
  if (got.status !== 200 || !got.text) {
    unknown.push(...ids.map((id) => `${id} (${got.status || got.error})`))
    await log(JOB, `unknown ${target}: ${got.status || got.error}`)
  } else {
    const text = norm(got.text)
    for (const id of ids) {
      const lost = facts[id].quotes.filter((q) => !text.includes(norm(q)))
      if (lost.length === 0) confirmed.push(id)
      else missing.push({ id, lost, url: facts[id].source.url })
    }
  }
  await new Promise((r) => setTimeout(r, 4000))
}

await log(JOB, `confirmed ${confirmed.length}, missing ${missing.length}, unknown ${unknown.length}`)

if (missing.length) {
  const lines = ['🔎 dwg facts-check: źródło się zmieniło, sprawdź te fakty (nic nie zostało zdjęte):']
  for (const m of missing) {
    lines.push('', `• ${m.id}`, `  brak cytatu: "${m.lost[0].slice(0, 120)}"`, `  ${m.url}`)
    const users = usersOf(m.id, m.url)
    if (users.length) lines.push(`  używają: ${users.join(', ')}`)
  }
  await notify(lines.join('\n'))
}

if (dryRun) {
  console.log(JSON.stringify({ confirmed, missing, unknown }, null, 2))
  process.exit(0)
}

// Move the check date of every confirmed fact, then publish the new dates.
const moved = confirmed.filter((id) => facts[id].checked !== TODAY)
if (moved.length === 0) process.exit(0)
for (const id of moved) facts[id].checked = TODAY
await writeFile(FACTS, `${JSON.stringify(facts, null, 2)}\n`, 'utf8')

const { stdout: dirty } = await run(GIT, ['status', '--porcelain'], { cwd: ROOT })
const others = dirty.split('\n').filter((l) => l.trim() && !l.endsWith('seo/facts.json'))
if (others.length) {
  await log(JOB, 'dates updated in seo/facts.json but not published: working tree has other changes')
  await notify('🔎 dwg facts-check: daty sprawdzenia zaktualizowane w seo/facts.json, ale nie wdrożone (w repo są inne niezacommitowane zmiany)')
  process.exit(0)
}
await run(GIT, ['add', 'seo/facts.json'], { cwd: ROOT })
await run(GIT, ['commit', '-m', `chore(facts): ${moved.length} facts re-checked against their sources\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`], { cwd: ROOT })
await run(GIT, ['push', 'origin', 'main'], { cwd: ROOT })
await run('/bin/bash', [join(ROOT, 'deploy.sh')], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 900000 })
await log(JOB, `published new check dates for ${moved.length} facts`)
