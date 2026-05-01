import { PaperTexture } from "@paper-design/shaders-react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import parseHtml from "html-react-parser";
import { getBook, getChapter } from "../lib/book";

const fetchChapter = createServerFn({ method: "GET" })
  .inputValidator((slug: unknown): string => {
    if (typeof slug !== "string") throw new Error("slug must be a string");
    return slug;
  })
  .handler(async ({ data }) => {
    const ch = await getChapter(data);
    if (!ch) return null;
    const book = getBook();
    return { chapter: ch, parts: book.parts };
  });

export const Route = createFileRoute("/chapters/$slug")({
  component: ChapterPage,
  loader: async ({ params }) => {
    const result = await fetchChapter({ data: params.slug });
    if (!result) throw notFound();
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData ? `${loaderData.chapter.title} · Effect Help` : "Effect Help",
      },
    ],
  }),
});

function formatWords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k words`;
  return `${n} words`;
}

function ChapterPage() {
  const { chapter, parts } = Route.useLoaderData();

  return (
    <div className="mx-auto grid max-w-[100rem] grid-cols-1 lg:grid-cols-[280px_1fr]">
      <nav className="hidden lg:block">
        <div className="sticky top-0 max-h-dvh overflow-y-auto px-8 pt-10 pb-20 font-serif text-xs">
          <Link to="/" className="font-mono text-base uppercase text-cobalt-600 hover:opacity-75">
            Effect Help
          </Link>
          <ol className="mt-10 list-decimal pl-5">
            {parts.map((part) => (
              <div key={part.id} className="not-first:mt-6">
                <li className="font-mono text-[11px] uppercase">{part.title}</li>
                <ul className="mt-3 list-disc pl-3">
                  {part.chapters.map((c) => (
                    <li key={c.slug} className="marker:text-[9px] marker:text-black/30">
                      <Link
                        to="/chapters/$slug"
                        params={{ slug: c.slug }}
                        className="block text-[12px] leading-6 text-black/75 hover:text-cobalt-600 data-[active=true]:text-cobalt-600 data-[active=true]:underline"
                        data-active={c.slug === chapter.slug}
                      >
                        {c.title}.
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </ol>
        </div>
      </nav>

      <main className="px-4 pt-8 pb-24 sm:px-8 lg:pt-20">
        <div className="mx-auto w-full max-w-3xl">
          <header className="text-center">
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-black/60">
              {chapter.partTitle}
              <span className="mx-2 text-black/20">|</span>
              ch {chapter.number}
              <span className="mx-2 text-black/20">|</span>
              {formatWords(chapter.wordCount)}
            </p>
            <h1 className="mt-6 font-serif text-4xl tracking-tight text-black/90 sm:text-5xl">
              {chapter.title}
            </h1>
            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-black/40">
              ╌╌╌╌
            </p>
          </header>

          <article className="chapter-card relative mt-12 px-6 py-12 sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute inset-0 [clip-path:inset(0_round_4px)]">
              <div className="sticky top-0 h-dvh w-full">
                <PaperTexture
                  className="absolute inset-0 h-full w-full opacity-60"
                  colorBack="#ffffff"
                  colorFront="#d1d1d166"
                  contrast={0.3}
                  roughness={0.4}
                  fiber={0.3}
                  fiberSize={0.2}
                  crumples={0.3}
                  crumpleSize={0.35}
                  folds={0.65}
                  foldCount={5}
                  drops={0.2}
                  fade={0}
                  seed={6}
                  scale={0.6}
                  fit="cover"
                />
              </div>
            </div>
            <div className="chapter-prose relative">{parseHtml(chapter.html)}</div>
          </article>

          <nav className="mt-12 grid grid-cols-1 gap-4 border-t border-black/10 pt-8 sm:grid-cols-2">
            <div>
              {chapter.prev ? (
                <Link
                  to="/chapters/$slug"
                  params={{ slug: chapter.prev.slug }}
                  className="block font-mono text-[10px] uppercase text-black/50 hover:text-cobalt-600"
                >
                  ← Previous
                  <span className="mt-1 block font-serif text-base normal-case text-black/85">
                    {chapter.prev.title}.
                  </span>
                </Link>
              ) : null}
            </div>
            <div className="text-right">
              {chapter.next ? (
                <Link
                  to="/chapters/$slug"
                  params={{ slug: chapter.next.slug }}
                  className="block font-mono text-[10px] uppercase text-black/50 hover:text-cobalt-600"
                >
                  Next →
                  <span className="mt-1 block font-serif text-base normal-case text-black/85">
                    {chapter.next.title}.
                  </span>
                </Link>
              ) : null}
            </div>
          </nav>

          <footer className="mt-16 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-black/40">
            <Link to="/" className="hover:text-cobalt-600">
              ← back to table of contents
            </Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
