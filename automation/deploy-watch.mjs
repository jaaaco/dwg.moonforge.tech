#!/usr/bin/env node
/**
 * Daily health check on the deployed site, plus the IndexNow ping.
 * Copied from pdf.techsource.pro; only the base URL and the names differ.
 *
 * The failure this guards against is the quiet one. A build that succeeds but
 * ships a broken prerender leaves every page returning HTTP 200 with the
 * homepage's title - the site looks fine to a human clicking around and is
 * invisible to a crawler. Nothing alerts on that unless something checks the
 * specific properties that matter for indexing.
 *
 * Silent when healthy. Telegram only carries bad news, or the first news
 * after a recovery.
 *
 *   node automation/deploy-watch.mjs
 *   node automation/deploy-watch.mjs --verbose   # print every check
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { ROOT, argOf, hasFlag, log, notify, readState, writeState } from './lib.mjs'

const run = promisify(execFile)

const BASE = (argOf('base', 'https://dwg.moonforge.tech')).replace(/\/$/, '')
const verbose = hasFlag('verbose')
const JOB = 'deploy-watch'

const problems = []
const fail = (message) => problems.push(message)

const fetchText = async (url) => {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  })
  return { status: response.status, body: await response.text() }
}

const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null
const canonicalOf = (html) => html.match(/rel="canonical"\s+href="([^"]+)"/i)?.[1] ?? null

/* ---------------------------------------------------------------- sitemap */

const sitemap = await fetchText(`${BASE}/sitemap.xml`)
if (sitemap.status !== 200) {
  fail(`sitemap.xml returned ${sitemap.status}`)
}

const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
if (urls.length === 0) fail('sitemap.xml lists no URLs')

/* ------------------------------------------------------------------ pages */

const titles = new Map()

for (const url of urls) {
  const { status, body } = await fetchText(url)

  if (status !== 200) {
    // A redirect here means a page and its canonical disagree about the URL
    // (on the PDF site: directory indexes and a 301 to a trailing slash).
    fail(`${url} -> HTTP ${status}`)
    continue
  }

  const title = titleOf(body)
  if (!title) {
    fail(`${url} has no <title>`)
  } else if (titles.has(title)) {
    // Two URLs sharing a title means the prerender did not run and every page
    // is serving the same shell.
    fail(`${url} has the same title as ${titles.get(title)}: "${title}"`)
  } else {
    titles.set(title, url)
  }

  const canonical = canonicalOf(body)
  if (!canonical) fail(`${url} has no canonical link`)
  else if (canonical !== url) fail(`${url} declares canonical ${canonical}`)

  if (verbose) await log(JOB, `ok ${url} "${title}"`)
}

/* ------------------------------------------------------------ static files */

const robots = await fetchText(`${BASE}/robots.txt`)
if (robots.status !== 200) fail(`robots.txt returned ${robots.status}`)
else if (!robots.body.includes('Sitemap:')) fail('robots.txt does not point at the sitemap')

const missing = await fetchText(`${BASE}/this-page-does-not-exist-${Date.now()}`)
if (missing.status !== 404) {
  // A 200 here means unknown URLs are being served the app shell, which gets
  // every typo indexed as a duplicate of the homepage.
  fail(`unknown URL returned ${missing.status}, expected 404`)
}

/* --------------------------------------------------------------- indexnow */

const previous = await readState(JOB, { lastPingedUrls: [], lastStatus: 'unknown' })
const changed = JSON.stringify(previous.lastPingedUrls) !== JSON.stringify(urls)

let pinged = false
if (problems.length === 0 && changed) {
  try {
    await run('/opt/homebrew/bin/node', [join(ROOT, 'scripts/indexnow.mjs')], { cwd: ROOT })
    pinged = true
    await log(JOB, `indexnow pinged for ${urls.length} URLs`)
  } catch (error) {
    await log(JOB, `indexnow failed: ${error.message}`)
  }
}

/* ----------------------------------------------------------------- report */

const status = problems.length === 0 ? 'ok' : 'failing'

if (problems.length > 0) {
  const message = [`🔴 dwg.moonforge.tech: ${problems.length} problem(ów)`, '', ...problems.slice(0, 12)]
  if (problems.length > 12) message.push(`…and ${problems.length - 12} more`)
  await notify(message.join('\n'))
  for (const problem of problems) await log(JOB, `FAIL ${problem}`)
} else {
  await log(JOB, `ok: ${urls.length} URLs, ${titles.size} distinct titles${pinged ? ', indexnow pinged' : ''}`)
  // Recovery is worth one message; steady health is not.
  if (previous.lastStatus === 'failing') {
    await notify(`🟢 dwg.moonforge.tech: znowu zdrowe, ${urls.length} URL-i w porządku`)
  }
}

await writeState(JOB, { lastPingedUrls: urls, lastStatus: status, checkedAt: new Date().toISOString() })

process.exit(problems.length === 0 ? 0 : 1)
