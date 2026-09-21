import { getCollection, type CollectionEntry } from 'astro:content'
import facts from '../../seo/facts.json'
import pagesJson from '../../seo/pages.json'
import { guidePath, path, type Locale, type RouteKey } from './i18n'

export type GuideEntry = CollectionEntry<'guides'>

// Everything a reader can be pointed to from a hub or a "related" box: the
// articles in content/ plus the hand-written pages from the route table.
export interface GuideLink {
  href: string
  title: string
  blurb: string
  cluster: string
  tags: string[]
  date: Date
}

// Hand-written pages for the hub and "related" boxes live in seo/pages.json,
// which the article generator reads too (they are the internal links it may use).
type PageEntry = { route: RouteKey; cluster: string; tags: string[]; hub: boolean; en: [string, string] | null; pl: [string, string] | null }
const pages = (pagesJson as unknown as { pages: PageEntry[] }).pages.filter((p) => p.hub)

// Pages written before the article collection existed share one date: the
// launch. Articles carry their own.
const LAUNCH = new Date('2026-09-17')

export async function articles(locale: Locale): Promise<GuideEntry[]> {
  const all = await getCollection('guides', (e) => e.data.locale === locale)
  return all.sort((a, b) => dateOf(b).getTime() - dateOf(a).getTime())
}

export function dateOf(e: GuideEntry): Date {
  return e.data.updated ?? e.data.date
}

/** The same article in the other language, if it exists. */
export async function counterpart(e: GuideEntry): Promise<GuideEntry | undefined> {
  const all = await getCollection('guides', (o) => o.data.key === e.data.key && o.data.locale !== e.data.locale)
  return all[0]
}

export async function guideLinks(locale: Locale): Promise<GuideLink[]> {
  const fromArticles = (await articles(locale)).map((e) => ({
    href: guidePath(locale, e.data.slug),
    title: e.data.title,
    blurb: e.data.description,
    cluster: e.data.cluster,
    tags: e.data.tags,
    date: dateOf(e)
  }))
  const fromPages = pages.flatMap((p) => {
    const label = p[locale]
    if (!label) return []
    return [{ href: path(p.route, locale), title: label[0], blurb: label[1], cluster: p.cluster, tags: p.tags, date: LAUNCH }]
  })
  return [...fromArticles, ...fromPages]
}

/**
 * Links for a "related" box: same cluster first, then shared tags, then the
 * newest. Always fills up to `limit` when there is enough to show, so a page
 * with an unusual topic still links somewhere instead of showing nothing.
 */
export function pickGuides(links: GuideLink[], opts: { cluster?: string; tags?: string[]; exclude?: string; limit?: number }): GuideLink[] {
  const { cluster, tags = [], exclude, limit = 3 } = opts
  const topic = cluster?.split(':')[0]
  const score = (l: GuideLink) =>
    (cluster && l.cluster === cluster ? 100 : 0) +
    (topic && l.cluster.split(':')[0] === topic ? 20 : 0) +
    l.tags.filter((t) => tags.includes(t)).length * 5
  return links
    .filter((l) => l.href !== exclude)
    .sort((a, b) => score(b) - score(a) || b.date.getTime() - a.date.getTime())
    .slice(0, limit)
}

type Fact = { names: string[]; claim: string; claim_pl: string; source: { url: string; title: string }; checked: string }
const factTable = facts as unknown as Record<string, Fact>

export function factById(id: string): Fact {
  const f = factTable[id]
  if (!f || id.startsWith('_')) throw new Error(`Unknown fact "${id}" (seo/facts.json)`)
  return f
}

/** Sources for a set of facts, one line per URL, and the oldest check date. */
export function sourcesFor(ids: string[]): { sources: { url: string; title: string }[]; checked: string | null } {
  const used = ids.map(factById)
  const seen = new Map<string, string>()
  for (const f of used) seen.set(f.source.url, f.source.title)
  const checked = used.map((f) => f.checked).sort()[0] ?? null
  return { sources: [...seen].map(([url, title]) => ({ url, title })), checked }
}
