import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { routes, guidePath, type Locale } from '../lib/i18n'

// Hand-rolled so every URL carries its hreflang pair and nothing else sneaks in.
// Route-table pages pair through the table, articles through their `key`.
export const GET: APIRoute = async ({ site }) => {
  const origin = site!.origin
  const entry = (loc: string, alts: [Locale, string][], lastmod?: Date) => {
    const links = alts.length > 1
      ? alts.map(([l, p]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${origin}${p}"/>`).join('\n') + '\n'
      : ''
    const mod = lastmod ? `    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>\n` : ''
    return `  <url>\n    <loc>${origin}${loc}</loc>\n${mod}${links}  </url>`
  }

  const pages = Object.values(routes).flatMap((variants) => {
    const present = (Object.entries(variants) as [Locale, string | null][]).filter(([, p]) => p !== null) as [Locale, string][]
    return present.map(([, p]) => entry(p, present))
  })

  const guides = await getCollection('guides')
  const byKey = new Map<string, typeof guides>()
  for (const g of guides) byKey.set(g.data.key, [...(byKey.get(g.data.key) ?? []), g])
  const articles = guides.map((g) => {
    const alts = byKey.get(g.data.key)!.map((o) => [o.data.locale, guidePath(o.data.locale, o.data.slug)] as [Locale, string])
    return entry(guidePath(g.data.locale, g.data.slug), alts, g.data.updated ?? g.data.date)
  })

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${[...pages, ...articles].join('\n')}\n</urlset>\n`
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } })
}
