import { auth } from '@clerk/nextjs/server';
import { ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { getPurchasesForUser } from '@/lib/buyer/purchases';
import { PurchaseRow } from '@/components/buyer/purchase-row';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';

export const dynamic = 'force-dynamic';

export default async function BuyerPurchasesPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const purchases = await getPurchasesForUser(userId);

  const statusSentence =
    purchases.length === 0
      ? 'No purchases yet.'
      : `${purchases.length} ${purchases.length === 1 ? 'purchase' : 'purchases'}.`;

  return (
    <div className="space-y-12">
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Purchases.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Purchase history
        </h1>
        <p className={cn(BODY_MUTED)}>{statusSentence}</p>
      </header>

      {purchases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <ShoppingBag size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-foreground">Nothing here yet.</p>
          <p className={cn('mt-1 text-xs', BODY_MUTED)}>
            Your purchases and bookings from providers will show up here.
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
          {purchases.map((p) => (
            <StaggerItem key={p.id}>
              <PurchaseRow purchase={p} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
}
