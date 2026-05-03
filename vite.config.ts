import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import fs from 'node:fs'
import path from 'node:path'

function collectChapterSlugs(dir: string): Array<string> {
  const slugs: Array<string> = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      slugs.push(...collectChapterSlugs(full))
      continue
    }
    const m = entry.name.match(/^(\d{2}-[a-z0-9-]+)\.md$/)
    if (m) slugs.push(m[1])
  }
  return slugs
}

const chapterSlugs = collectChapterSlugs(path.resolve('book'))

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        routes: ['/', ...chapterSlugs.map((s) => `/chapters/${s}`)],
      },
    }),
    viteReact(),
  ],
})

export default config
