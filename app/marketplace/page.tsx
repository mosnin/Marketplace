/**
 * /marketplace — the public consumer browse page.
 *
 * Server component: reads services from Supabase (via the marketplace data
 * layer, which normalizes the renamed real-estate "Service"/"Space" tables),
 * then renders a hero with search, the eight-category grid, and a grid of
 * service cards. An optional `?q=` filters the cards by title / provider /
 * category — done in-process because the underlying table has no marketplace
 * category column and the result set is small.
 *
 * No auth: this is a public surface, same posture as /book/[slug] and /p/[slug].
 * Empty DB → the grid renders its calm empty state.
 */

import type { Metadata } from 'next';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import { MarketplaceHero } from '@/components/marketplace/marketplace-hero';
import { CategoryGrid } from '@/components/marketplace/category-grid';
import { ServiceGrid } from '@/components/marketplace/service-grid';
import { listMarketplaceServices, type MarketplaceService } from '@/components/marketplace/marketplace-data';

export const metadata: Metadata = {
  title: 'Marketplace · Koala',
  description:
    'Browse and book trusted professionals — stylists, trainers, coaches, photographers, tutors, and more.',
};

// Revalidate the public listing periodically; the data is read-only and a
// minute of staleness is fine for a browse surface.
export const revalidate = 60;

function filterByQuery(services: MarketplaceService[], q: string): MarketplaceService[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return services;
  return services.filter((s) => {
    const haystack = [s.title, s.providerName ?? '', s.categoryLabel, s.description ?? '']
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export default async function MarketplaceBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const all = await listMarketplaceServices();
  const services = filterByQuery(all, q);
  const isSearch = q.trim().length > 0;

  return (
    <MarketplaceShell searchQuery={q}>
      <MarketplaceHero />

      <div className="mx-auto max-w-6xl space-y-14 px-4 py-12 sm:px-6 sm:py-16">
        {/* Categories — hidden during an active search so results lead. */}
        {!isSearch && (
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-[21px] font-semibold tracking-tight text-foreground">
                Browse by category
              </h2>
              <p className="text-sm text-muted-foreground">
                Pick a category, or search for exactly what you need.
              </p>
            </div>
            <CategoryGrid />
          </section>
        )}

        {/* Services grid. */}
        <section className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-[21px] font-semibold tracking-tight text-foreground">
              {isSearch ? `Results for “${q.trim()}”` : 'Available now'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isSearch
                ? `${services.length} ${services.length === 1 ? 'service' : 'services'} found.`
                : 'Fresh services from professionals on Koala.'}
            </p>
          </div>
          <ServiceGrid
            services={services}
            emptyTitle={isSearch ? 'Nothing matched that search.' : 'No services yet.'}
            emptyHint={
              isSearch
                ? 'Try a broader term, or browse the categories above.'
                : 'Check back soon — providers are setting up their storefronts.'
            }
          />
        </section>
      </div>
    </MarketplaceShell>
  );
}
