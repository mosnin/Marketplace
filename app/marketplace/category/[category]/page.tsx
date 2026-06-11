/**
 * /marketplace/category/[category] — filtered browse for one category.
 *
 * Resolves the category slug to a known MarketplaceCategory (404 on unknown),
 * then renders the services mapped into that category. Same shell, same card
 * grid, same calm empty state as the main browse page.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import { CategoryGrid } from '@/components/marketplace/category-grid';
import { ServiceGrid } from '@/components/marketplace/service-grid';
import {
  getCategoryBySlug,
  listMarketplaceServicesByCategory,
} from '@/components/marketplace/marketplace-data';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const match = getCategoryBySlug(category);
  if (!match) return { title: 'Category · Koala' };
  return {
    title: `${match.label} · Koala marketplace`,
    description: match.blurb,
  };
}

export default async function MarketplaceCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const match = getCategoryBySlug(category);
  if (!match) notFound();

  const services = await listMarketplaceServicesByCategory(match.slug);

  return (
    <MarketplaceShell>
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6 sm:py-12">
        {/* Header — back link + category title + count. */}
        <header className="space-y-3">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft size={15} aria-hidden />
            All categories
          </Link>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{match.label}</h1>
            <p className="text-sm text-muted-foreground">
              {match.blurb}{' '}
              <span className="text-muted-foreground/70">
                · {services.length} {services.length === 1 ? 'service' : 'services'}
              </span>
            </p>
          </div>
        </header>

        {/* Results. */}
        <ServiceGrid
          services={services}
          emptyTitle={`No ${match.label.toLowerCase()} services yet.`}
          emptyHint="Check back soon, or browse another category below."
        />

        {/* Other categories — keep browsing. */}
        <section className="space-y-6 border-t border-border/60 pt-12">
          <h2 className="text-[17px] font-semibold text-foreground">Explore other categories</h2>
          <CategoryGrid />
        </section>
      </div>
    </MarketplaceShell>
  );
}
