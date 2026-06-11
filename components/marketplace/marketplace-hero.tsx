/**
 * MarketplaceHero — the top of the browse page. One focal line + a large
 * search input. Consumer surface, so a warm brand wash behind the headline is
 * allowed; the search box is the focal element and the eye should land there.
 * The form submits to /marketplace (server reads ?q=).
 */

import { Search } from 'lucide-react';

export function MarketplaceHero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60 bg-brand-subtle/40">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,150,79,0.10),transparent_60%)]" />
      <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Find a pro. Book in minutes.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
          Stylists, trainers, coaches, photographers, tutors, and more — browse trusted
          professionals and book the service you need.
        </p>

        <form action="/marketplace" method="get" className="mx-auto mt-8 max-w-xl">
          <div className="relative">
            <Search
              size={18}
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              name="q"
              placeholder="Try haircut, personal trainer, headshots…"
              aria-label="Search the marketplace"
              className="h-12 w-full rounded-full border border-border/70 bg-background pl-11 pr-28 text-base text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-foreground/30 focus:outline-none"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1.5 inline-flex h-9 items-center rounded-full bg-brand px-5 text-sm font-semibold text-brand-foreground transition-all hover:brightness-105 active:scale-[0.98]"
            >
              Search
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
