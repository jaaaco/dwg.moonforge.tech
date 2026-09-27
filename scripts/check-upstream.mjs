#!/usr/bin/env node
/**
 * Asks the same question about every fix in scripts/cad-patches.mjs: is the bug
 * still in the latest published package?
 *
 * We carry seven patches over the pinned @mlightcad packages. Each one is
 * either a bug worth sending upstream or dead weight we should drop, and the
 * answer changes with every release. Doing this by hand means re-deriving the
 * same greps over minified bundles, which is what this script exists to avoid.
 *
 * It installs the latest version of each package into a temporary directory
 * (never touching node_modules here) and tests each patch's `from` pattern
 * against it:
 *
 *   still broken   the pattern matches: the bug is live upstream, our patch
 *                  stays, and if `upstream.state` says NOT reported, it is a
 *                  contribution waiting to be made
 *   check by hand  the pattern is gone: either fixed upstream or the code was
 *                  rewritten. Verify before dropping our patch, and before
 *                  reporting anything, because reporting a fixed bug costs
 *                  credibility
 *
 *   node scripts/check-upstream.mjs
 *   node scripts/check-upstream.mjs --keep   # leave the temp install in place
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patches } from './cad-patches.mjs'

const NPM = '/opt/homebrew/bin/npm'
const keep = process.argv.includes('--keep')

const packageOf = (file) => file.split('/').slice(0, 2).join('/')
const packages = [...new Set(patches.flatMap((p) => p.files.map(packageOf)))]

// One install per package, each in its own directory. Installed together, npm
// resolves a shared dependency to whatever the strictest package allows: asking
// for mtext-renderer alongside cad-simple-viewer gets 0.12.13, not the 0.13.0
// this check is supposed to look at.
const dir = mkdtempSync(join(tmpdir(), 'dwg-upstream-'))
const dirOf = (pkg) => join(dir, pkg.replace(/[@/]/g, '_'))
console.log(`checking the latest ${packages.join(', ')}\n`)
for (const pkg of packages) {
  mkdirSync(dirOf(pkg), { recursive: true })
  writeFileSync(join(dirOf(pkg), 'package.json'), '{"name":"upstream-check","private":true}\n')
  execFileSync(NPM, ['install', '--silent', '--no-audit', '--no-fund', `${pkg}@latest`], { cwd: dirOf(pkg), stdio: 'inherit' })
}

const pathOf = (rel) => join(dirOf(packageOf(rel)), 'node_modules', rel)
const versionOf = (pkg) => JSON.parse(readFileSync(join(dirOf(pkg), 'node_modules', pkg, 'package.json'), 'utf8')).version

let broken = 0
let gone = 0

for (const patch of patches) {
  const results = patch.files.map((rel) => {
    const file = pathOf(rel)
    if (!existsSync(file)) return { rel, state: 'missing' }
    const src = readFileSync(file, 'utf8')
    return { rel, state: patch.from.test(src) ? 'broken' : 'gone', version: versionOf(packageOf(rel)) }
  })
  const state = results.every((r) => r.state === 'broken')
    ? 'broken'
    : results.every((r) => r.state === 'gone')
      ? 'gone'
      : 'mixed'
  state === 'gone' ? gone++ : broken++

  const mark = state === 'broken' ? '🔴 still broken ' : state === 'gone' ? '🟢 check by hand' : '🟡 mixed        '
  console.log(`${mark} ${patch.name}`)
  for (const r of results) console.log(`                 ${r.rel} @ ${r.version ?? '-'} — ${r.state}`)
  if (patch.upstream) {
    const { issue, pr, repo, state: note } = patch.upstream
    for (const link of [issue, pr, repo].filter(Boolean)) console.log(`                 ${link}`)
    console.log(`                 ${note}`)
  }
  console.log()
}

console.log(`${broken} of ${patches.length} patches still carry their weight against the latest packages.`)
console.log('A "check by hand" line means the code moved: confirm on the new version before dropping the patch or reporting the bug.')

if (keep) console.log(`\ntemp install left at ${dir}`)
else rmSync(dir, { recursive: true, force: true })
