import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CalendarCheck, ChevronRight, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED, SECTION_LABEL } from '@/lib/typography';
import { getPurchase, type PurchaseService } from '@/lib/buyer/purchases';
import { formatAmount } from '@/lib/buyer/format';
import { PurchaseStatusBadge } from '@/components/buyer/purchase-status-badge';
import { PurchaseTimeline } from '@/components/buyer/purchase-timeline';

export const dynamic = 'force-dynamic';

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Time to be confirmed';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Time to be confirmed';
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function serviceLine(service: PurchaseService): string {
  return [service.address, service.city, service.stateRegion]
    .filter(Boolean)
    .join(', ') || 'Service';
}

export default async function BuyerPurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;

  const { id } = await params;
  const purchase = await getPurchase(userId, id);
  if (!purchase) notFound();

  const amount = formatAmount(purchase.amountCents, purchase.currency);
  const providerName = purchase.provider?.name ?? 'Provider';

  return (
    <div className="space-y-12">
      {/* Breadcrumb. */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Link href="/buyer/purchases" className="transition-colors hover:text-foreground">
          Purchases
        </Link>
        <ChevronRight size={11} aria-hidden className="text-muted-foreground/60" />
        <span className="truncate text-foreground">{purchase.title}</span>
      </nav>

      {/* Header. */}
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Order from {providerName}.</p>
        <div className="flex items-start justify-between gap-4">
          <h1 className={cn(H1, 'min-w-0')} style={TITLE_FONT}>
            {purchase.title}
          </h1>
          <PurchaseStatusBadge status={purchase.status} className="mt-1.5 flex-shrink-0" />
        </div>
        <p className={cn(BODY_MUTED)}>
          Requested {formatDate(purchase.createdAt)}
          {amount ? ` · ${amount}` : ''}
        </p>
      </header>

      {/* Status timeline. */}
      <section className="space-y-3">
        <h2 className={cn(SECTION_LABEL, 'border-b border-border/60 pb-2')}>Status</h2>
        <div className="rounded-xl border border-border/70 bg-card px-4 py-5">
          <PurchaseTimeline status={purchase.status} />
        </div>
      </section>

      {/* Provider. */}
      <section className="space-y-3">
        <h2 className={cn(SECTION_LABEL, 'border-b border-border/60 pb-2')}>Provider</h2>
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-foreground/[0.04] text-lg">
            {purchase.provider?.emoji ?? <Store size={18} className="text-muted-foreground" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{providerName}</p>
            <p className="truncate text-xs text-muted-foreground">Provider</p>
          </div>
          {purchase.provider?.slug && (
            <a
              href={`/p/${purchase.provider.slug}`}
              className="flex-shrink-0 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
              View profile
            </a>
          )}
        </div>
      </section>

      {/* Service. */}
      {purchase.service && (
        <section className="space-y-3">
          <h2 className={cn(SECTION_LABEL, 'border-b border-border/60 pb-2')}>Service</h2>
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3 space-y-1">
            <p className="text-sm font-medium text-foreground">
              {serviceLine(purchase.service)}
            </p>
            <p className="text-xs text-muted-foreground">
              {purchase.service.serviceType
                ? purchase.service.serviceType.replace(/_/g, ' ')
                : 'Service'}
              {purchase.service.listPrice != null
                ? ` · ${formatAmount(Math.round(purchase.service.listPrice * 100), 'usd')}`
                : ''}
            </p>
          </div>
        </section>
      )}

      {/* Appointment. */}
      {purchase.appointment && (
        <section className="space-y-3">
          <h2 className={cn(SECTION_LABEL, 'border-b border-border/60 pb-2')}>Appointment</h2>
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
              <CalendarCheck size={18} className="text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {formatDateTime(purchase.appointment.startsAt)}
              </p>
              {purchase.appointment.serviceAddress && (
                <p className="truncate text-xs text-muted-foreground">
                  {purchase.appointment.serviceAddress}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Notes. */}
      {purchase.notes && (
        <section className="space-y-3">
          <h2 className={cn(SECTION_LABEL, 'border-b border-border/60 pb-2')}>Notes</h2>
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <p className={cn('whitespace-pre-wrap text-sm text-foreground')}>{purchase.notes}</p>
          </div>
        </section>
      )}
    </div>
  );
}
