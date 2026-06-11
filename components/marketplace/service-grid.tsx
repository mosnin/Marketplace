/**
 * ServiceGrid — renders a list of services as the card grid, or a tasteful
 * empty state when there are none. Both the browse page and the category page
 * use it so the empty-DB experience is identical and calm.
 */

import { SearchX } from 'lucide-react';
import type { MarketplaceService } from './marketplace-data';
import { ServiceCard } from './service-card';

interface ServiceGridProps {
  services: MarketplaceService[];
  /** Headline for the empty state — written per surface. */
  emptyTitle?: string;
  /** Second line of the empty state. */
  emptyHint?: string;
}

export function ServiceGrid({
  services,
  emptyTitle = 'No services yet.',
  emptyHint = 'Check back soon — providers are setting up their storefronts.',
}: ServiceGridProps) {
  if (services.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground/[0.04]">
          <SearchX size={18} aria-hidden className="text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-[320px] text-[13px] leading-relaxed text-muted-foreground">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {services.map((service) => (
        <ServiceCard key={service.id} service={service} />
      ))}
    </div>
  );
}
