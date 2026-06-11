/**
 * A single purchase row in a divide-y list. Used by the buyer dashboard
 * (recent purchases) and the full purchase history. Links to the detail page.
 *
 * Row vocabulary per STYLESHEET.md: no card chrome, the divider is the
 * structure; title is the loud note, provider + date recede to muted, one
 * status chip on the right, optional amount in tabular-nums.
 */
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PurchaseStatusBadge } from '@/components/buyer/purchase-status-badge';
import { formatAmount } from '@/lib/buyer/format';
import type { BuyerPurchase } from '@/lib/buyer/purchases';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PurchaseRow({ purchase }: { purchase: BuyerPurchase }) {
  const amount = formatAmount(purchase.amountCents, purchase.currency);
  const providerName = purchase.space?.name ?? 'Provider';

  return (
    <Link
      href={`/buyer/purchases/${purchase.id}`}
      className={cn(
        'flex items-center gap-3 -mx-2 rounded-md px-2 py-3 transition-colors',
        'hover:bg-foreground/[0.04]',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium text-foreground">
          {purchase.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {providerName}
          <span className="text-muted-foreground/60"> · </span>
          {formatDate(purchase.createdAt)}
        </p>
      </div>

      {amount && (
        <p className="hidden flex-shrink-0 text-sm tabular-nums text-foreground sm:block">
          {amount}
        </p>
      )}
      <PurchaseStatusBadge status={purchase.status} className="flex-shrink-0" />
    </Link>
  );
}
