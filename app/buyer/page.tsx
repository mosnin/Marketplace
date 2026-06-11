import { auth, currentUser } from '@clerk/nextjs/server';
import Link from 'next/link';
import { CalendarCheck, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  STAT_NUMBER_COMPACT,
  SECTION_LABEL,
} from '@/lib/typography';
import {
  getPurchasesForUser,
  getUpcomingAppointmentsForUser,
  ACTIVE_PURCHASE_STATUSES,
} from '@/lib/buyer/purchases';
import { formatAmount } from '@/lib/buyer/format';
import { PurchaseRow } from '@/components/buyer/purchase-row';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';

export const dynamic = 'force-dynamic';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatApptTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export default async function BuyerDashboardPage() {
  // The layout already gates signed-out users; this is a defensive resolve.
  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  const firstName = user?.firstName ?? null;

  const [purchases, upcoming] = await Promise.all([
    getPurchasesForUser(userId),
    getUpcomingAppointmentsForUser(userId, 5),
  ]);

  const activeCount = purchases.filter((p) =>
    (ACTIVE_PURCHASE_STATUSES as string[]).includes(p.status),
  ).length;

  // Total spent counts completed orders only — money the buyer has actually
  // settled, not in-flight requests that may still change or be cancelled.
  const totalSpentCents = purchases
    .filter((p) => p.status === 'completed' && p.amountCents != null)
    .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const totalSpent = formatAmount(totalSpentCents, 'usd') ?? '$0.00';

  const recent = purchases.slice(0, 5);

  const statusSentence =
    purchases.length === 0
      ? 'No purchases yet — explore the marketplace to get started.'
      : activeCount > 0
        ? `${activeCount} active ${activeCount === 1 ? 'order' : 'orders'} in progress.`
        : 'You are all caught up.';

  return (
    <div className="space-y-12">
      {/* Header — status-sentence pattern. */}
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>{greeting()}{firstName ? `, ${firstName}` : ''}.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Your purchases
        </h1>
        <p className={cn(BODY_MUTED)}>{statusSentence}</p>
      </header>

      {/* Stats — hairline-divider grid. */}
      <section
        className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60"
      >
        <div className="bg-background px-4 py-4">
          <p className={cn(SECTION_LABEL)}>Active</p>
          <p className={cn(STAT_NUMBER_COMPACT, 'mt-1')}>{activeCount}</p>
        </div>
        <div className="bg-background px-4 py-4">
          <p className={cn(SECTION_LABEL)}>Upcoming</p>
          <p className={cn(STAT_NUMBER_COMPACT, 'mt-1')}>{upcoming.length}</p>
        </div>
        <div className="bg-background px-4 py-4">
          <p className={cn(SECTION_LABEL)}>Total spent</p>
          <p className={cn(STAT_NUMBER_COMPACT, 'mt-1')}>{totalSpent}</p>
        </div>
      </section>

      {/* Recent purchases. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <h2 className={cn(SECTION_LABEL)}>Recent purchases</h2>
          {purchases.length > 5 && (
            <Link
              href="/buyer/purchases"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
            </Link>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <ShoppingBag size={24} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
            <p className="text-sm text-foreground">No purchases yet.</p>
            <p className={cn('mt-1 text-xs', BODY_MUTED)}>
              Anything you book from a provider shows up here.
            </p>
            <a
              href="/marketplace"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ShoppingBag size={12} aria-hidden />
              Browse marketplace
            </a>
          </div>
        ) : (
          <StaggerList stagger={0.03} className="divide-y divide-border/60">
            {recent.map((p) => (
              <StaggerItem key={p.id}>
                <PurchaseRow purchase={p} />
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>

      {/* Upcoming appointments. */}
      <section className="space-y-3">
        <div className="border-b border-border/60 pb-2">
          <h2 className={cn(SECTION_LABEL)}>Upcoming appointments</h2>
        </div>

        {upcoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <CalendarCheck size={24} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
            <p className="text-sm text-foreground">Nothing scheduled.</p>
            <p className={cn('mt-1 text-xs', BODY_MUTED)}>
              Booked appointments from your purchases appear here.
            </p>
          </div>
        ) : (
          <StaggerList stagger={0.03} className="divide-y divide-border/60">
            {upcoming.map((appt) => (
              <StaggerItem key={appt.id}>
                <Link
                  href={`/buyer/purchases/${appt.purchaseId}`}
                  className="flex items-center gap-3 -mx-2 rounded-md px-2 py-3 transition-colors hover:bg-foreground/[0.04]"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
                    <CalendarCheck size={16} className="text-muted-foreground" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium text-foreground">
                      {appt.purchaseTitle}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {appt.space?.name ?? 'Provider'}
                    </p>
                  </div>
                  <p className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatApptTime(appt.startsAt)}
                  </p>
                </Link>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </div>
  );
}
