/**
 * ServiceCard — one service in the browse / category grids.
 *
 * Shows the brief's required facts: service name, provider/space name,
 * category, price, duration, and a rating PLACEHOLDER (no ratings data exists
 * yet, so we render a muted "New" affordance rather than inventing stars).
 * The whole card links to the detail page at /marketplace/s/[id].
 *
 * Consumer surface → brand orange + a soft hover lift are allowed here.
 */

import Link from 'next/link';
import { Star, Clock } from 'lucide-react';
import type { MarketplaceService } from './marketplace-data';
import { formatServicePrice, formatServiceDuration } from './marketplace-data';

export function ServiceCard({ service }: { service: MarketplaceService }) {
  const duration = formatServiceDuration(service.durationMin);
  return (
    <Link
      href={`/marketplace/s/${service.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-lg hover:shadow-black/5"
    >
      {/* Cover — falls back to a calm tinted block with the category label. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {service.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={service.photo}
            alt={service.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-brand-subtle">
            <span className="text-sm font-medium text-brand">{service.categoryLabel}</span>
          </div>
        )}
        <span className="absolute left-3 top-3 inline-flex rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-medium text-foreground backdrop-blur">
          {service.categoryLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="space-y-0.5">
          <h3 className="line-clamp-1 text-sm font-semibold text-foreground">{service.title}</h3>
          {service.providerName && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{service.providerName}</p>
          )}
        </div>

        {/* Rating placeholder — no ratings table yet, so this is an honest
            "New" affordance, not invented stars. */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Star size={13} aria-hidden className="text-muted-foreground/50" />
          <span>New</span>
          {duration && (
            <>
              <span aria-hidden>·</span>
              <Clock size={13} aria-hidden className="text-muted-foreground/50" />
              <span>{duration}</span>
            </>
          )}
        </div>

        <div className="mt-auto flex items-baseline justify-between pt-1">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatServicePrice(service.price)}
          </span>
          <span className="text-xs text-brand opacity-0 transition-opacity group-hover:opacity-100">
            View
          </span>
        </div>
      </div>
    </Link>
  );
}
