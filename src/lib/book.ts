import { markdownToHtml } from './markdown'

const rawChapters = import.meta.glob('/book/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const rawToc = import.meta.glob('/book/00-toc.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export type ChapterEntry = {
  number: string
  title: string
  slug: string
  wordCount: number
  partTitle: string
}

export type Part = {
  id: string
  title: string
  goal: string
  chapters: Array<ChapterEntry>
}

export type Book = {
  title: string
  subtitle: string
  parts: Array<Part>
  totalWords: number
  totalChapters: number
}

const slugFiles: Record<string, { path: string; raw: string }> = {}
for (const [path, raw] of Object.entries(rawChapters)) {
  const m = path.match(/\/(\d{2})-([a-z0-9-]+)\.md$/)
  if (!m) continue
  const slug = `${m[1]}-${m[2]}`
  slugFiles[slug] = { path, raw }
}

function countWords(md: string): number {
  const stripped = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_~`-]/g, ' ')
  const words = stripped.split(/\s+/).filter(Boolean)
  return words.length
}

let cachedBook: Book | null = null

export function getBook(): Book {
  if (cachedBook) return cachedBook

  const tocSrc = Object.values(rawToc)[0] ?? ''
  const lines = tocSrc.split('\n')

  const parts: Array<Part> = []
  let currentPart: Part | null = null
  let currentGoalBuf = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const partMatch = line.match(/^## (Part [IVX]+) — (.+)$/)
    if (partMatch) {
      if (currentPart) {
        currentPart.goal = currentGoalBuf.trim()
        parts.push(currentPart)
      }
      currentPart = {
        id: partMatch[1].replace(/\s+/g, '-').toLowerCase(),
        title: `${partMatch[1]} — ${partMatch[2]}`,
        goal: '',
        chapters: [],
      }
      currentGoalBuf = ''
      continue
    }

    if (currentPart && /^Goal:/.test(line.trim())) {
      currentGoalBuf = line.trim().replace(/^Goal:\s*/, '')
      continue
    }

    const rowMatch = line.match(/^\|\s*(\d{2})\s*\|\s*(.+?)\s*\|\s*`([a-z0-9-]+)`\s*\|/)
    if (rowMatch && currentPart) {
      const [, num, title, slug] = rowMatch
      const file = slugFiles[slug]
      const wordCount = file ? countWords(file.raw) : 0
      currentPart.chapters.push({
        number: num,
        title,
        slug,
        wordCount,
        partTitle: currentPart.title,
      })
    }

    if (line.startsWith('## Reading paths by goal')) break
  }

  if (currentPart) {
    currentPart.goal = currentGoalBuf.trim()
    parts.push(currentPart)
  }

  const totalWords = parts.reduce(
    (a, p) => a + p.chapters.reduce((s, c) => s + c.wordCount, 0),
    0,
  )
  const totalChapters = parts.reduce((a, p) => a + p.chapters.length, 0)

  cachedBook = {
    title: 'Effect Help',
    subtitle:
      'A reference manual for the Effect TypeScript ecosystem — every package, every pattern, with citations to source.',
    parts,
    totalWords,
    totalChapters,
  }
  return cachedBook
}

const htmlCache = new Map<string, string>()

export async function getChapter(slug: string): Promise<
  | {
      slug: string
      number: string
      title: string
      partTitle: string
      html: string
      wordCount: number
      prev: ChapterEntry | null
      next: ChapterEntry | null
    }
  | null
> {
  const file = slugFiles[slug]
  if (!file) return null

  const book = getBook()
  const flat = book.parts.flatMap((p) => p.chapters)
  const idx = flat.findIndex((c) => c.slug === slug)
  const meta = idx >= 0 ? flat[idx] : null
  const prev = idx > 0 ? flat[idx - 1] : null
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null

  let body = file.raw

  body = body.replace(
    /\(\.\.\/\.\.\/research\/02-patterns-catalog\.md(#[^)]*)?\)/g,
    '(/patterns$1)',
  )
  body = body.replace(/\((\d{2})-([a-z0-9-]+)\.md\)/g, '(/chapters/$1-$2)')
  body = body.replace(
    /\(\.\.\/(\d{2})-([a-z0-9-]+)\.md\)/g,
    '(/chapters/$1-$2)',
  )
  body = body.replace(
    /\(\.\.\/part-\d-[a-z-]+\/(\d{2})-([a-z0-9-]+)\.md\)/g,
    '(/chapters/$1-$2)',
  )

  let title = meta?.title ?? slug
  let number = meta?.number ?? ''
  const h1 = body.match(/^#\s+Chapter\s+(\d+)\s*[—-]\s*(.+)$/m)
  if (h1) {
    number = h1[1].padStart(2, '0')
    title = h1[2].trim()
  }

  body = body.replace(/^#\s+Chapter\s+\d+\s*[—-]\s*.+$/m, '')

  let html = htmlCache.get(slug)
  if (!html) {
    html = await markdownToHtml(body)
    htmlCache.set(slug, html)
  }

  return {
    slug,
    number,
    title,
    partTitle: meta?.partTitle ?? '',
    html,
    wordCount: countWords(body),
    prev,
    next,
  }
}
