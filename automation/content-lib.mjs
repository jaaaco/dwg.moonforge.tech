/**
 * What content-gen needs to know about the site, and the checks a generated
 * draft has to pass. Kept apart from content-gen.mjs so the checks can be run
 * on hand-made drafts (automation/test-guards.mjs) without calling a model.
 *
 * Publishing is fully automatic on this site (owner's decision, 2026-09-21),
 * so these checks are the only review a draft gets before it is live under the
 * Moonforge name. They lean strict: a rejected draft costs one run, a wrong
 * claim about Autodesk costs credibility that does not come back.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { ROOT } from './lib.mjs'

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

export const loadSeo = () => ({
  site: readJson('seo/site.json'),
  clusters: readJson('seo/clusters.json').clusters,
  facts: Object.fromEntries(Object.entries(readJson('seo/facts.json')).filter(([k]) => !k.startsWith('_'))),
  features: readJson('seo/features.json'),
  policy: readJson('seo/policy.json'),
  measured: readJson('seo/measured.json').items,
  pages: readJson('seo/pages.json').pages,
})

export const GUIDE_BASE = { en: '/guides', pl: '/pl/poradniki' }

/**
 * The route table, read from src/lib/i18n.ts rather than restated here, so a
 * page added to the site is a link the generator may use the same day.
 */
export const routeTable = () => {
  const src = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8')
  const block = src.slice(src.indexOf('export const routes'), src.indexOf('} as const'))
  const table = {}
  for (const m of block.matchAll(/(\w+): \{ en: (null|'[^']*'), pl: (null|'[^']*') \}/g)) {
    const val = (v) => (v === 'null' ? null : v.slice(1, -1))
    table[m[1]] = { en: val(m[2]), pl: val(m[3]) }
  }
  return table
}

const splitFrontMatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { data: null, body: text }
  try {
    return { data: yaml.load(m[1]) ?? {}, body: m[2] }
  } catch (error) {
    return { data: null, body: m[2], error: error.message }
  }
}

/** Articles already in content/, as {locale, slug, key, title, cluster, path}. */
export const existingArticles = () => {
  const out = []
  for (const locale of ['en', 'pl']) {
    const dir = join(ROOT, 'content', locale)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const { data } = splitFrontMatter(readFileSync(join(dir, file), 'utf8'))
      if (!data) continue
      out.push({ locale, slug: data.slug, key: data.key, title: data.title, cluster: data.cluster, path: `${GUIDE_BASE[locale]}/${data.slug}`, file: join(dir, file) })
    }
  }
  return out
}

/** Internal links an article in `locale` may use, with the text that describes them. */
export const linkMenu = (seo, locale) => {
  const routes = routeTable()
  const menu = []
  for (const page of seo.pages) {
    const path = routes[page.route]?.[locale]
    const label = page[locale]
    if (path && label) menu.push({ path, title: label[0], note: label[1] })
  }
  for (const a of existingArticles().filter((x) => x.locale === locale)) {
    menu.push({ path: a.path, title: a.title, note: `guide, ${a.cluster}` })
  }
  return menu
}

/** Every number a draft may attach a unit to. */
export const numberAllowlist = (seo) => {
  const allowed = new Set()
  const add = (v) => {
    const s = String(v)
    allowed.add(s)
    allowed.add(s.replace(',', '.'))
    allowed.add(s.replace('.', ','))
  }
  for (const f of Object.values(seo.facts)) for (const n of f.numbers ?? []) add(n)
  for (const m of seo.measured) for (const n of m.numbers ?? []) add(n)
  // Line widths offered in the PDF panel.
  for (const n of ['0.13', '0.2', '0.20', '0.35']) add(n)
  return allowed
}

const stripMarkdown = (text) => text.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']')

const sentences = (text) =>
  stripMarkdown(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Checks a model's answer. `raw` is what the model returned: front matter with
 * title, description and faq, then the body starting with the H1. Returns
 * { ok: true, data, body } or { ok: false, reason }.
 */
export const validateDraft = (raw, ctx) => {
  const { seo, locale, cluster } = ctx
  const fail = (reason) => ({ ok: false, reason })

  const text = raw.replace(/^```(?:markdown|md|yaml)?\n/, '').replace(/\n```\s*$/, '').trim()
  const { data, body, error } = splitFrontMatter(text)
  if (!data) return fail(`front matter missing or not valid YAML${error ? ` (${error.split('\n')[0]})` : ''}; starts with: ${text.slice(0, 160).replace(/\n/g, '\\n')}`)

  const title = String(data.title ?? '').trim()
  const description = String(data.description ?? '').trim()
  const faq = Array.isArray(data.faq) ? data.faq : []
  if (title.length < 20 || title.length > 70) return fail(`title is ${title.length} characters, needs 20-70`)
  if (description.length < 50 || description.length > 170) return fail(`description is ${description.length} characters, needs 50-170`)
  if (faq.length < 2 || faq.length > 6 || faq.some((f) => typeof f?.q !== 'string' || typeof f?.a !== 'string')) {
    return fail('faq must be 2-6 items, each with string q and a')
  }

  const trimmed = body.trim()
  if (!trimmed.startsWith('# ')) return fail('body must start with a single "# " heading')
  if ((trimmed.match(/^# /gm) ?? []).length !== 1) return fail('body has more than one H1')

  const words = trimmed.split(/\s+/).filter(Boolean).length
  if (words < 450) return fail(`only ${words} words in the body, needs at least 450`)
  if (words > 1600) return fail(`${words} words in the body, keep it under 1600`)

  const everything = [title, description, trimmed, ...faq.flatMap((f) => [f.q, f.a])].join('\n')

  // Links: internal only, and only to pages that exist in this language.
  // Sources are appended from seo/facts.json by the template, never linked by
  // the model, which is how an invented URL never reaches the page.
  if (/https?:\/\//i.test(everything)) return fail('contains an external URL; link only to pages of this site, sources are added automatically')
  const allowed = new Set(linkMenu(seo, locale).map((l) => l.path))
  const links = [...trimmed.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1].replace(/#.*$/, ''))
  const bad = links.filter((l) => !allowed.has(l))
  if (bad.length) return fail(`links to pages that do not exist in ${locale}: ${[...new Set(bad)].join(', ')}`)
  if (links.length < 2) return fail('links to fewer than 2 pages of this site; link the viewer and at least one related guide')

  // Numbers with a unit have to come from something measured or sourced.
  const allowedNumbers = numberAllowlist(seo)
  const unitNumbers = [...everything.matchAll(/(\d+(?:[.,]\d+)?)\s?(%|ms\b|s\b|sec\w*|seconds?\b|sekund\w*|min\b|minut\w*|MB\b|KB\b|GB\b|kB\b)/g)]
  const invented = unitNumbers.map((m) => m[1]).filter((n) => !allowedNumbers.has(n))
  if (invented.length) return fail(`quotes figures that are neither measured nor sourced: ${[...new Set(unitNumbers.filter((m) => !allowedNumbers.has(m[1])).map((m) => m[0]))].join(', ')}`)

  // Claims the site must never make. A negatable rule is judged per sentence,
  // because its negation is the true statement the page wants to make.
  const negation = new RegExp(seo.features.negations.join('|'), 'i')
  const allSentences = sentences(everything)
  for (const rule of seo.policy.banned) {
    const re = new RegExp(rule.pattern, 'i')
    const hit = rule.negatable
      ? allSentences.find((s) => re.test(s) && !negation.test(s))
      : everything.match(re)?.[0]
    if (hit) return fail(`banned claim (${rule.why}): "${String(hit).slice(0, 140)}"`)
  }

  // Other products only through the facts this cluster was given.
  const licensed = new Set(cluster.facts.flatMap((id) => seo.facts[id]?.names ?? []))
  for (const c of seo.policy.competitors) {
    if (new RegExp(c.pattern, 'i').test(everything) && !licensed.has(c.name)) {
      return fail(`names ${c.name}, but this topic has no sourced fact about it`)
    }
  }

  // Promises the viewer cannot keep.
  for (const s of sentences([trimmed, ...faq.map((f) => f.a)].join('\n'))) {
    if (negation.test(s)) continue
    for (const pattern of seo.features.cannotPatterns) {
      if (new RegExp(pattern, 'i').test(s)) return fail(`promises something the viewer cannot do: "${s.slice(0, 140)}"`)
    }
  }

  // Style and language.
  if (/—/.test(everything)) return fail('uses em dashes; use a comma, colon, full stop or brackets instead')
  if (locale === 'pl' && / – /.test(everything)) return fail('uses a dash as a pause; use a comma, colon, full stop or brackets instead')
  const letters = everything.replace(/[^\p{L}]/gu, '')
  const polish = (everything.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) ?? []).length
  if (locale === 'pl' && polish / letters.length < 0.01) return fail('does not read as Polish (almost no Polish letters)')
  if (locale === 'en' && polish > 5) return fail('English article contains Polish text')

  return { ok: true, data: { title, description, faq }, body: trimmed, words, links: links.length }
}

/** The file that goes into content/: front matter owned by the script, text by the model. */
export const composeArticle = ({ cluster, locale, date }, data, body) => {
  const side = cluster[locale]
  const fm = {
    title: data.title,
    description: data.description,
    key: cluster.key,
    locale,
    slug: side.slug,
    date,
    cluster: cluster.cluster,
    tags: cluster.tags,
    facts: cluster.facts,
    tool: cluster.tool,
    faq: data.faq,
  }
  const head = yaml.dump(fm, { lineWidth: -1, quotingType: '"' })
  return `---\n${head}---\n\n${body}\n`
}

/** Next thing to write: highest-priority engine cluster with a missing language, Polish first. */
export const pickNext = (seo, { key = null, lang = null } = {}) => {
  const written = new Set(existingArticles().map((a) => `${a.key}:${a.locale}`))
  const queue = seo.clusters
    .filter((c) => c.owner === 'engine' && (!key || c.key === key))
    .sort((a, b) => a.priority - b.priority)
  for (const c of queue) {
    for (const locale of ['pl', 'en']) {
      if (lang && locale !== lang) continue
      if (!c[locale] || (c.retired ?? []).includes(locale)) continue
      if (written.has(`${c.key}:${locale}`)) continue
      return { cluster: c, locale }
    }
  }
  return null
}

export { splitFrontMatter }
