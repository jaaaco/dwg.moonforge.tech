#!/usr/bin/env node
/**
 * Submits the sitemap's URLs to IndexNow.
 *
 * IndexNow is a push protocol: instead of waiting for Bing, Yandex and Seznam
 * to come back and re-crawl, the site tells them what changed. It is free, it
 * needs no account and no OAuth - the only credential is a key file served
 * from the site's own root, which proves ownership. Google does not
 * participate, so Search Console remains the channel that matters there.
 *
 * Reads the built sitemap rather than the route manifest so that whatever was
 * actually deployed is what gets submitted.
 *
 *   node scripts/indexnow.mjs             # submit every URL in the sitemap
 *   node scripts/indexnow.mjs --dry-run   # print the payload, send nothing
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const ENDPOINT = 'https://api.indexnow.org/indexnow'

const dryRun = process.argv.includes('--dry-run')

const site = JSON.parse(await readFile(join(ROOT, 'seo/site.json'), 'utf8'))
const origin = site.origin.replace(/\/$/, '')
const host = new URL(origin).host

/** The key is the basename of the 32-char text file dropped in public/. */
const findKey = async () => {
  const entries = await readdir(join(ROOT, 'public'))
  const keyFile = entries.find((name) => /^[a-f0-9]{32}\.txt$/.test(name))
  if (!keyFile) {
    throw new Error('no IndexNow key file in public/ - expected <32-hex>.txt')
  }
  return keyFile.replace(/\.txt$/, '')
}

const readSitemapUrls = async () => {
  const xml = await readFile(join(DIST, 'sitemap.xml'), 'utf8')
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
}

const key = await findKey()
const urlList = await readSitemapUrls()

if (urlList.length === 0) {
  console.error('[indexnow] sitemap has no URLs - did the build run?')
  process.exit(1)
}

const payload = {
  host,
  key,
  keyLocation: `${origin}/${key}.txt`,
  urlList,
}

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
})

// 200 accepted, 202 accepted but the key is still being verified. Both fine.
if (response.status === 200 || response.status === 202) {
  console.log(`[indexnow] ${response.status} - submitted ${urlList.length} URLs for ${host}`)
  process.exit(0)
}

console.error(`[indexnow] ${response.status} ${response.statusText}`)
console.error(await response.text())
process.exit(1)
