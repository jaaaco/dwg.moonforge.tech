#!/usr/bin/env node
/**
 * Takes a published guide down: removes the file, sends its URL on with a 301,
 * marks the topic's language as retired so content-gen does not write it
 * again, and deploys. The undo button that fully automatic publishing needs.
 *
 *   node automation/unpublish.mjs --lang=pl --slug=plik-dwg-co-to
 *   node automation/unpublish.mjs --lang=en --slug=dwg-layers --to=/guides/dwg-vs-dxf --reason="thin"
 *
 * Without --to the URL goes to the guides hub of its language.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT, argOf, log, notify } from './lib.mjs'
import { GUIDE_BASE, splitFrontMatter } from './content-lib.mjs'

const run = promisify(execFile)
const GIT = '/usr/bin/git'
const NPM = '/opt/homebrew/bin/npm'
const JOB = 'unpublish'

const lang = argOf('lang')
const slug = argOf('slug')
const reason = argOf('reason', 'no reason given')
if (!['en', 'pl'].includes(lang) || !slug) {
  console.error('usage: node automation/unpublish.mjs --lang=en|pl --slug=<slug> [--to=/path] [--reason="..."]')
  process.exit(2)
}

const rel = `content/${lang}/${slug}.md`
const file = join(ROOT, rel)
if (!existsSync(file)) {
  console.error(`no such article: ${rel}`)
  process.exit(1)
}

const { stdout: dirty } = await run(GIT, ['status', '--porcelain'], { cwd: ROOT })
if (dirty.trim()) {
  console.error(`working tree not clean, commit or stash first:\n${dirty}`)
  process.exit(1)
}
await run(GIT, ['pull', '--ff-only', 'origin', 'main'], { cwd: ROOT })

const { data } = splitFrontMatter(readFileSync(file, 'utf8'))
const from = `${GUIDE_BASE[lang]}/${slug}`
const to = argOf('to', GUIDE_BASE[lang])

await run(GIT, ['rm', '-q', rel], { cwd: ROOT })
await appendFile(join(ROOT, 'public/_redirects'), `${from} ${to} 301\n`, 'utf8')

const clustersPath = join(ROOT, 'seo/clusters.json')
const map = JSON.parse(readFileSync(clustersPath, 'utf8'))
const cluster = map.clusters.find((c) => c.key === data?.key)
if (cluster) cluster.retired = [...new Set([...(cluster.retired ?? []), lang])]
await writeFile(clustersPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8')

await run(NPM, ['run', 'build'], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 600000 })
await run(GIT, ['add', 'public/_redirects', 'seo/clusters.json'], { cwd: ROOT })
await run(GIT, ['commit', '-m', `content(${lang}): retire ${slug}\n\n${from} -> ${to} (301). Reason: ${reason}\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`], { cwd: ROOT })
await run(GIT, ['push', 'origin', 'main'], { cwd: ROOT })
await run('/bin/bash', [join(ROOT, 'deploy.sh')], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 900000 })

await log(JOB, `retired ${from} -> ${to} (${reason})`)
await notify(`🗑️ dwg.moonforge.tech: wycofane ${from} → ${to} (301)\npowód: ${reason}`)
