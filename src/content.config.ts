import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

// Articles: content/<locale>/<slug>.md. One file per language; the two
// language versions of the same article share a `key`.
const guides = defineCollection({
  loader: glob({ pattern: '*/*.md', base: './content' }),
  schema: z.object({
    title: z.string().max(70),
    description: z.string().min(50).max(170),
    key: z.string(),
    locale: z.enum(['en', 'pl']),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    cluster: z.string(),
    tags: z.array(z.string()).default([]),
    // Ids from seo/facts.json. The Sources section is built from them.
    facts: z.array(z.string()).default([]),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    // Where the call to action points: the plain viewer or a tool page.
    tool: z.enum(['home', 'dwgToPdf', 'dxfViewer', 'measure']).default('home')
  })
})

export const collections = { guides }
