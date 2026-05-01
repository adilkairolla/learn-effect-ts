import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getBook, type Book } from '../lib/book'

const fetchBook = createServerFn({ method: 'GET' }).handler(() => getBook())

export const Route = createFileRoute('/')({
  component: Home,
  loader: () => fetchBook(),
})

function formatWords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k words`
  return `${n} words`
}

function Home() {
  const book = Route.useLoaderData() as Book

  return (
    <main className="mx-auto max-w-[80rem] px-6 pt-16 pb-24 sm:px-12 sm:pt-24">
      {/* Hero */}
      <section className="text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/50">
          ░ effect-help · v0.1
        </p>
        <h1 className="mt-6 font-serif text-5xl tracking-tight text-black sm:text-6xl">
          {book.title}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-black/70 sm:text-xl">
          {book.subtitle}
        </p>
        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-black/40">
          ╌╌╌╌╌
        </p>
      </section>

      {/* ToC header */}
      <section className="mt-24">
        <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[auto_1fr_auto] md:gap-4">
          <h3 className="relative font-serif text-base">
            Table of Contents.
            <sup className="absolute -top-1 -right-5 font-mono text-[10px] uppercase text-black/50">
              v0.1
            </sup>
          </h3>
          <div className="h-px w-full bg-black" />
          <div className="font-mono text-xs uppercase text-black/60">
            <span className="text-black">{book.totalChapters} chapters</span>
            <span className="mx-2 text-black/30">⋅</span>
            <span>{Math.round(book.totalWords / 1000)}k words</span>
          </div>
        </div>

        {/* Parts and chapters */}
        <ol className="mt-12 columns-1 gap-x-[6%] px-2 md:columns-2 xl:columns-3">
          {book.parts.map((part) => (
            <div
              key={part.id}
              className="break-inside-avoid not-first:mt-10 [column-fill:balance]"
            >
              <li className="font-mono text-sm uppercase text-black">
                <a
                  href={`#${part.id}`}
                  id={part.id}
                  className="hover:text-cobalt-600"
                >
                  {part.title}
                </a>
              </li>
              {part.goal ? (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-black/40">
                  {part.goal}
                </p>
              ) : null}
              <ul className="mt-4 list-disc pl-5 text-sm">
                {part.chapters.map((c) => (
                  <li
                    key={c.slug}
                    className="marker:text-[10px] marker:text-black/40"
                  >
                    <Link
                      to="/chapters/$slug"
                      params={{ slug: c.slug }}
                      className="toc-row group block py-[3px]"
                    >
                      <span className="title font-serif text-[15px] leading-6 text-black">
                        <span className="font-mono text-[10px] text-black/40 mr-1.5">
                          {c.number}
                        </span>
                        {c.title}.
                      </span>
                      <span className="leader" />
                      <span className="words font-mono text-[10px] uppercase text-black/45 whitespace-nowrap">
                        {c.wordCount > 0 ? formatWords(c.wordCount) : '—'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </ol>
      </section>

      {/* Footer */}
      <footer className="mt-24 border-t border-black/10 pt-6 font-mono text-[10px] uppercase tracking-wider text-black/50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>effect-help</span>
          <span>
            pinned to{' '}
            <a
              href="https://github.com/Effect-TS/effect"
              className="hover:text-cobalt-600"
              target="_blank"
              rel="noreferrer"
            >
              effect@3.21.2
            </a>
          </span>
        </div>
      </footer>
    </main>
  )
}
