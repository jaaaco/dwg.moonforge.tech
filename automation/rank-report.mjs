#!/usr/bin/env node
/**
 * Weekly Search Console digest for dwg.moonforge.tech, on Telegram.
 *
 * Ported from pdf.techsource.pro, where the lesson was that a traffic number
 * on a young domain says nothing. What is actionable before rankings exist:
 *
 *   1. Indexation: sitemap URLs with no impressions, and (--inspect) the hard
 *      "indexed or not" per URL.
 *   2. Cannibalisation: one query served by several of our pages.
 *   3. Positions 11-20: the only pages worth pushing.
 *
 * Added here: pages older than 45 days that still have no impression (rewrite
 * or retire them), harvested phrases that fit no topic yet (the next topics to
 * add to seo/clusters.json), and fresh Super User questions about opening DWG,
 * where an honest answer with a link is welcome (answered by a human, never by
 * a bot).
 *
 * The site sits inside the domain property for moonforge.tech, so every query
 * is filtered to dwg.moonforge.tech pages.
 *
 *   node automation/rank-report.mjs
 *   node automation/rank-report.mjs --inspect
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, argOf, hasFlag, log, notify, readState, writeState } from './lib.mjs'
import { inspectUrl, resolveSite, searchAnalytics } from './gsc.mjs'
import { existingArticles, loadSeo } from './content-lib.mjs'

const JOB = 'rank-report'
const seo = loadSeo()
const ORIGIN = seo.site.origin
const pageFilter = { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: seo.site.gscPageFilter }] }] }

/** Search Console data lags two to three days; asking for yesterday returns nothing. */
const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
const END = argOf('end', day(3))
const START = argOf('start', day(31))
const pct = (value) => `${value >= 0 ? '+' : ''}${value}`
const short = (url) => url.replace(ORIGIN, '') || '/'

const freshQuestions = async () => {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&fromdate=${since}&pagesize=10&site=superuser&q=dwg`
  try {
    const data = await (await fetch(url, { signal: AbortSignal.timeout(15000) })).json()
    return (data.items ?? []).filter((q) => !q.is_answered).slice(0, 3).map((q) => `${q.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'")}\n    ${q.link}`)
  } catch {
    return []
  }
}

const main = async () => {
  const site = await resolveSite(seo.site.gscProperty)
  await log(JOB, `property ${site}, window ${START}..${END}`)

  const [byPage, byQueryPage, totals] = await Promise.all([
    searchAnalytics(site, { startDate: START, endDate: END, dimensions: ['page'], ...pageFilter }),
    searchAnalytics(site, { startDate: START, endDate: END, dimensions: ['query', 'page'], ...pageFilter }),
    searchAnalytics(site, { startDate: START, endDate: END, ...pageFilter }),
  ])

  const total = totals.rows?.[0] ?? { clicks: 0, impressions: 0 }
  const pages = byPage.rows ?? []

  const sitemapXml = await (await fetch(`${ORIGIN}/sitemap.xml`, { signal: AbortSignal.timeout(15000) })).text()
  const published = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const seen = new Set(pages.map((row) => row.keys[0]))
  const silent = published.filter((url) => !seen.has(url))

  // Articles past 45 days with nothing to show: candidates to rewrite or retire.
  const cutoff = Date.now() - 45 * 86_400_000
  const stale = existingArticles()
    .filter((a) => {
      const text = readFileSync(a.file, 'utf8')
      const date = new Date(text.match(/^date: "?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? Date.now())
      return date.getTime() < cutoff && !seen.has(ORIGIN + a.path)
    })
    .map((a) => a.path)

  const perQuery = new Map()
  for (const row of byQueryPage.rows ?? []) {
    const [query, page] = row.keys
    if (!perQuery.has(query)) perQuery.set(query, new Map())
    perQuery.get(query).set(page, (perQuery.get(query).get(page) ?? 0) + row.impressions)
  }
  const clashes = [...perQuery.entries()]
    .filter(([, byUrl]) => byUrl.size > 1)
    .map(([query, byUrl]) => ({ query, pages: [...byUrl.entries()].sort((a, b) => b[1] - a[1]) }))
    .sort((a, b) => b.pages.length - a.pages.length)
    .slice(0, 8)

  const striking = pages
    .filter((row) => row.position > 10 && row.position <= 20 && row.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8)

  const previous = await readState(JOB, { impressions: 0, clicks: 0 })

  let indexation = null
  if (hasFlag('inspect')) {
    indexation = []
    for (const url of published) {
      try {
        const result = await inspectUrl(site, url)
        indexation.push({ url, verdict: result.indexStatusResult?.coverageState ?? 'unknown' })
      } catch (error) {
        indexation.push({ url, verdict: `error: ${error.message.slice(0, 80)}` })
      }
    }
  }

  // Harvested phrases no topic covers yet, newest first.
  const keywordsFile = join(ROOT, 'content/keywords.jsonl')
  const unfiled = existsSync(keywordsFile)
    ? readFileSync(keywordsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.cluster).reverse().slice(0, 8)
    : []

  const questions = await freshQuestions()

  const lines = [
    `📊 dwg.moonforge.tech · GSC ${START} → ${END}`,
    `${Math.round(total.impressions)} impresji (${pct(Math.round(total.impressions - previous.impressions))}), ` +
      `${Math.round(total.clicks)} kliknięć (${pct(Math.round(total.clicks - previous.clicks))})`,
    `${seen.size}/${published.length} URL-i z sitemapy ma jakąkolwiek impresję`,
  ]
  if (clashes.length) {
    lines.push('', '🔴 Kanibalizacja: jedna fraza, kilka naszych stron:')
    for (const { query, pages: hits } of clashes) {
      lines.push(`• "${query}": ${hits.length} stron`)
      for (const [url, impressions] of hits.slice(0, 3)) lines.push(`    ${short(url)} (${Math.round(impressions)})`)
    }
  }
  if (striking.length) {
    lines.push('', '🎯 Pozycje 11–20 (opłaca się dobić):')
    for (const row of striking) lines.push(`• ${short(row.keys[0])}: poz. ${row.position.toFixed(1)}, ${Math.round(row.impressions)} imp.`)
  }
  if (stale.length) {
    lines.push('', `🪦 Artykuły starsze niż 45 dni bez impresji (${stale.length}): przepisać albo wycofać`)
    for (const p of stale.slice(0, 8)) lines.push(`• ${p}`)
  }
  if (silent.length) {
    lines.push('', `🕳️ Zero impresji (${silent.length}):`)
    for (const url of silent.slice(0, 10)) lines.push(`• ${short(url)}`)
  }
  if (indexation) {
    lines.push('', '🔍 Indeksacja:')
    for (const row of indexation) lines.push(`• ${short(row.url)}: ${row.verdict}`)
  }
  if (unfiled.length) {
    lines.push('', '🧭 Frazy bez tematu (kandydaci do seo/clusters.json):')
    for (const r of unfiled) lines.push(`• [${r.lang}] ${r.phrase}`)
  }
  if (questions.length) {
    lines.push('', '💬 Świeże pytania bez odpowiedzi (Super User), odpowiada człowiek:')
    for (const q of questions) lines.push(`• ${q}`)
  }

  const report = lines.join('\n')
  console.log(report)
  await notify(report)
  await writeState(JOB, { impressions: total.impressions, clicks: total.clicks, end: END })
  await log(JOB, `${Math.round(total.impressions)} impressions, ${clashes.length} cannibalised queries, ${silent.length} silent URLs, ${stale.length} stale`)
}

main().catch(async (error) => {
  await log(JOB, `FAILED: ${error.message}`)
  await notify(`🔴 dwg rank-report: ${error.message}`)
  process.exit(1)
})
