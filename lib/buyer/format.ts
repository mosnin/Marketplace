/**
 * Buyer-side presentation helpers — money + purchase-status display.
 *
 * Kept separate from the data layer (lib/buyer/purchases.ts) so server data
 * access has no UI concerns and these pure helpers can be imported by both
 * server components and client components.
 */

import type { PurchaseStatus } from '@/lib/buyer/purchases';

/**
 * Format a minor-unit amount (e.g. Stripe cents) into a currency string.
 * `amountCents` is the integer minor unit; `currency` is the lowercase ISO
 * code stored on the Purchase row ('usd'). Returns null for a null amount so
 * callers can choose their own "no price" copy.
 */
export function formatAmount(
  amountCents: number | null | undefined,
  currency = 'usd',
): string | null {
  if (amountCents == null) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    // Unknown currency code — fall back to a plain decimal with the code.
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Human label for each lifecycle status. */
export function purchaseStatusLabel(status: PurchaseStatus): string {
  switch (status) {
    case 'requested':   return 'Requested';
    case 'confirmed':   return 'Confirmed';
    case 'in_progress': return 'In progress';
    case 'delivered':   return 'Delivered';
    case 'completed':   return 'Completed';
    case 'cancelled':   return 'Cancelled';
    default:            return status;
  }
}

/**
 * Tailwind tone classes for a status chip. Per STYLESHEET.md the tone palette
 * (amber/emerald/rose) is sparing; a purchase status is the buyer's order
 * progressing, so we tint only the meaningful endpoints:
 *   - requested / confirmed / in_progress / delivered → neutral muted (in-flight)
 *   - completed → emerald (done)
 *   - cancelled → rose (terminal/failed)
 * One chip per row, exactly as the stylesheet's status-pill rule requires.
 */
export function purchaseStatusToneClass(status: PurchaseStatus): string {
  switch (status) {
    case 'completed':
      return 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15';
    case 'cancelled':
      return 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15';
    default:
      return 'text-muted-foreground bg-muted';
  }
}
