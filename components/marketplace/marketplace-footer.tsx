/**
 * Marketplace footer — a simple, quiet close for the consumer marketplace.
 * Mirrors the header's calm vocabulary (neutral, hairline border, one orange
 * wordmark accent). No ASCII, no dark slab — the marketing footer does that
 * job on the pitch site; the marketplace stays light and utilitarian.
 */

import Link from 'next/link';

export function MarketplaceFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-1">
          <Link href="/marketplace" className="inline-flex items-center" aria-label="Koala marketplace">
            <span className="text-base font-semibold tracking-tight text-foreground">
              Koala<span className="text-brand">.</span>
            </span>
          </Link>
          <p className="text-xs text-muted-foreground">
            Book trusted professionals for the things you need done.
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/marketplace" className="transition-colors hover:text-foreground">
            Browse
          </Link>
          <Link href="/buyer" className="transition-colors hover:text-foreground">
            My purchases
          </Link>
          <Link href="/" className="transition-colors hover:text-foreground">
            For professionals
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
        </nav>
      </div>
      <div className="border-t border-border/60">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground sm:px-6">
          © {year} Koala
        </p>
      </div>
    </footer>
  );
}
