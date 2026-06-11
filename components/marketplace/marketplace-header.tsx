/**
 * Marketplace header — the chrome for the public consumer marketplace.
 *
 * This is a DIFFERENT surface from both the product (paper-flat, neutral) and
 * the marketing fortitudo nav (floating ASCII pill). The marketplace wants the
 * calm, e-commerce feel of a browse experience: a quiet sticky bar with the
 * Koala wordmark, an always-present search input, and the two cross-links the
 * brief calls for — "For professionals" (→ the marketing site) and
 * "My purchases" (→ the buyer area another team owns).
 *
 * It lives on the logged-out, consumer side, so brand orange is allowed here
 * (components/marketplace is outside the product strict zone). We keep it to
 * the wordmark accent only — the bar itself stays neutral so service cards are
 * the focal element of the page.
 */

import Link from 'next/link';
import { Search, Briefcase, ShoppingBag } from 'lucide-react';

interface MarketplaceHeaderProps {
  /** Pre-fills the search box (e.g. on a search-results render). */
  defaultQuery?: string;
}

export function MarketplaceHeader({ defaultQuery = '' }: MarketplaceHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        {/* Wordmark — the one brand-orange accent in the bar. */}
        <Link href="/marketplace" className="flex shrink-0 items-center gap-2" aria-label="Koala marketplace">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Koala
            <span className="text-brand">.</span>
          </span>
          <span className="hidden text-sm text-muted-foreground sm:inline">marketplace</span>
        </Link>

        {/* Search — present on every marketplace page; submits to /marketplace. */}
        <form action="/marketplace" method="get" className="relative flex-1 max-w-md">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            name="q"
            defaultValue={defaultQuery}
            placeholder="Search services and providers"
            aria-label="Search the marketplace"
            className="h-9 w-full rounded-full border border-border/70 bg-background pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-foreground/30 focus:outline-none"
          />
        </form>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/"
            className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            <Briefcase size={15} aria-hidden />
            For professionals
          </Link>
          <Link
            href="/buyer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
          >
            <ShoppingBag size={15} aria-hidden />
            <span className="hidden sm:inline">My purchases</span>
            <span className="sm:hidden">Purchases</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
