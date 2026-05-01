import rehypeShikiFromHighlighter from '@shikijs/rehype/core'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {
  createHighlighterCore,
  type HighlighterCore,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { unified, type Processor } from 'unified'

const themes = { light: 'github-light', dark: 'github-dark' } as const

let highlighterPromise: Promise<HighlighterCore> | null = null
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      langs: [
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/bash.mjs'),
        import('shiki/langs/diff.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/jsonc.mjs'),
        import('shiki/langs/markdown.mjs'),
      ],
      themes: [
        import('shiki/themes/github-light.mjs'),
        import('shiki/themes/github-dark.mjs'),
      ],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  }
  return highlighterPromise
}

let processorPromise: Promise<Processor> | null = null
async function getProcessor() {
  if (processorPromise) return processorPromise
  processorPromise = (async () => {
    const highlighter = await getHighlighter()
    return unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeShikiFromHighlighter, highlighter, {
        themes,
        defaultColor: 'light',
        fallbackLanguage: 'text',
      })
      .use(rehypeStringify, { allowDangerousHtml: true }) as unknown as Processor
  })()
  return processorPromise
}

export async function markdownToHtml(md: string): Promise<string> {
  const processor = await getProcessor()
  const file = await processor.process(md)
  return String(file)
}
