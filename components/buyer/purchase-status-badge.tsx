/**
 * Inline status chip for a Purchase. Follows the stylesheet's status-pill
 * pattern (tone-tinted bg + tone-tinted text, rounded-full). One per row.
 */
import { cn } from '@/lib/utils';
import {
  purchaseStatusLabel,
  purchaseStatusToneClass,
} from '@/lib/buyer/format';
import type { PurchaseStatus } from '@/lib/buyer/purchases';

interface Props {
  status: PurchaseStatus;
  className?: string;
}

export function PurchaseStatusBadge({ status, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        purchaseStatusToneClass(status),
        className,
      )}
    >
      {purchaseStatusLabel(status)}
    </span>
  );
}
