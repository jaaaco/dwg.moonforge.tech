import type { APIRoute } from 'astro'
import { routes, type Locale } from '../lib/i18n'

// Hand-rolled so every URL carries its hreflang pair and nothing else sneaks in.
export const GET: APIRoute = ({ site }) => {
  const origin = site!.origin
  const urls = Object.values(routes).flatMap((variants) => {
    const present = (Object.entries(variants) as [Locale, string | null][]).filter(([, p]) => p !== null) as [Locale, string][]
    return present.map(([, p]) => {
      const alts = present.length > 1
        ? present.map(([l, ap]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${origin}${ap}"/>`).join('\n') + '\n'
        : ''
      return `  <url>\n    <loc>${origin}${p}</loc>\n${alts}  </url>`
    })
  })
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } })
}
