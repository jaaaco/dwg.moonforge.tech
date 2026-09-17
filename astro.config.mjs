import { defineConfig } from 'astro/config'

// Static output only: every page is a real HTML file with its own title,
// description and canonical, so crawlers never see an empty SPA shell
// (the indexing lesson from pdf.techsource.pro).
export default defineConfig({
  site: 'https://dwg.moonforge.tech',
  trailingSlash: 'never',
  build: { format: 'file' },
  devToolbar: { enabled: false },
  vite: {
    worker: { format: 'es' }
  }
})
