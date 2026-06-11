/**
 * MarketplaceShell — wraps every consumer marketplace page with the shared
 * header + footer so the surface reads as one product. Pages pass their body
 * as children; the shell owns the page scaffold (min-height, background, the
 * sticky header, the simple footer).
 */

import type { ReactNode } from 'react';
import { MarketplaceHeader } from './marketplace-header';
import { MarketplaceFooter } from './marketplace-footer';

interface MarketplaceShellProps {
  children: ReactNode;
  /** Pre-fills the header search box (search-results renders). */
  searchQuery?: string;
}

export function MarketplaceShell({ children, searchQuery }: MarketplaceShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MarketplaceHeader defaultQuery={searchQuery} />
      <main className="flex-1">{children}</main>
      <MarketplaceFooter />
    </div>
  );
}
