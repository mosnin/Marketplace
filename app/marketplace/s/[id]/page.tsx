/**
 * /marketplace/s/[id] — service detail page.
 *
 * Resolves one normalized service by id (404 when it doesn't exist), then
 * shows the photo, description, provider info, price, and duration, with two
 * actions:
 *   1. "Book now" — the prominent CTA. Links to the EXISTING public booking
 *      flow at /book/[providerSlug] (the slug comes from the provider's Space).
 *      We intentionally do NOT append the Service id as ?serviceId=, because in
 *      this schema that param selects an AppointmentServiceProfile row, not a
 *      Service row — passing a Service id there would be a no-op at best and a
 *      confusing mismatch at worst. A clean link to the provider's booking page
 *      is the correct, non-broken behaviour.
 *   2. "Sign in to track your purchases" — links to /buyer (another team's area).
 *
 * Public, no auth. Empty/missing provider degrades to a calm "booking
 * unavailable" affordance instead of a dead button.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Clock, Tag, Store, Star, CalendarCheck, ShoppingBag } from 'lucide-react';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import {
  getMarketplaceService,
  formatServicePrice,
  formatServiceDuration,
} from '@/components/marketplace/marketplace-data';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const service = await getMarketplaceService(id);
  if (!service) return { title: 'Service · Koala' };
  return {
    title: `${service.title} · Koala`,
    description: service.description ?? `Book ${service.title} on Koala.`,
  };
}

export default async function MarketplaceServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getMarketplaceService(id);
  if (!service) notFound();

  const duration = formatServiceDuration(service.durationMin);
  const canBook = Boolean(service.providerSlug);

  return (
    <MarketplaceShell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <Link
          href={`/marketplace/category/${service.categorySlug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft size={15} aria-hidden />
          {service.categoryLabel}
        </Link>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
          {/* Left column — media + description. */}
          <div className="space-y-6">
            <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-border/70 bg-muted">
              {service.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={service.photo}
                  alt={service.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-brand-subtle">
                  <span className="text-base font-medium text-brand">{service.categoryLabel}</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  <Tag size={12} aria-hidden />
                  {service.categoryLabel}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Star size={13} aria-hidden className="text-muted-foreground/50" />
                  New — no reviews yet
                </span>
              </div>

              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {service.title}
              </h1>

              {service.providerName && (
                <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Store size={14} aria-hidden />
                  Offered by {service.providerName}
                </p>
              )}
            </div>

            <div className="space-y-2 border-t border-border/60 pt-6">
              <h2 className="text-[17px] font-semibold text-foreground">About this service</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {service.description?.trim()
                  ? service.description
                  : 'The provider hasn’t added a description for this service yet. Book a time and they’ll confirm the details with you directly.'}
              </p>
            </div>
          </div>

          {/* Right column — sticky booking panel. */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-xl border border-border/70 bg-card p-5">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatServicePrice(service.price)}
                </span>
                {duration && (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock size={14} aria-hidden />
                    {duration}
                  </span>
                )}
              </div>

              <div className="mt-5">
                {canBook ? (
                  <Link
                    href={`/book/${service.providerSlug}`}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand text-sm font-semibold text-brand-foreground transition-all hover:brightness-105 active:scale-[0.98]"
                  >
                    <CalendarCheck size={16} aria-hidden />
                    Book now
                  </Link>
                ) : (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-center">
                    <p className="text-sm font-medium text-foreground">Booking unavailable</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      This provider hasn’t opened their booking page yet.
                    </p>
                  </div>
                )}
              </div>

              <Link
                href="/buyer"
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ShoppingBag size={14} aria-hidden />
                Sign in to track your purchases
              </Link>

              <p className="mt-4 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
                You’ll pick a time on the provider’s booking page and they’ll confirm your
                appointment.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </MarketplaceShell>
  );
}
