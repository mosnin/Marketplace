/**
 * Purchase status timeline — renders the fulfilment lifecycle
 * (requested → confirmed → in progress → delivered → completed) as a
 * horizontal stepper, with the steps up to and including the current status
 * marked done.
 *
 * Paper-flat: a hairline track with foreground dots for reached steps and
 * muted hollow dots for the rest. No orange — this is buyer order state, not
 * Koala authorship (STYLESHEET.md's brand-orange rule).
 *
 * A `cancelled` purchase never reached `completed`; we show the lifecycle
 * dimmed with a single rose "Cancelled" note so the buyer sees the order
 * stopped rather than a misleading half-filled progress bar.
 */
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PURCHASE_TIMELINE,
  type PurchaseStatus,
} from '@/lib/buyer/purchases';
import { purchaseStatusLabel } from '@/lib/buyer/format';

interface Props {
  status: PurchaseStatus;
  className?: string;
}

export function PurchaseTimeline({ status, className }: Props) {
  const isCancelled = status === 'cancelled';
  // Index of the current status within the happy-path lifecycle. For a
  // cancelled order there's no position on the line, so nothing is "reached".
  const currentIndex = isCancelled
    ? -1
    : PURCHASE_TIMELINE.indexOf(status);

  return (
    <div className={cn('space-y-3', className)}>
      <ol
        className={cn(
          'flex items-center',
          isCancelled && 'opacity-50',
        )}
      >
        {PURCHASE_TIMELINE.map((step, i) => {
          const reached = !isCancelled && i <= currentIndex;
          const isLast = i === PURCHASE_TIMELINE.length - 1;
          return (
            <li
              key={step}
              className={cn('flex items-center', !isLast && 'flex-1')}
            >
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                    reached
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border/70 bg-background text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {reached ? <Check size={11} strokeWidth={2.5} /> : i + 1}
                </span>
                <span
                  className={cn(
                    'text-[11px] whitespace-nowrap',
                    reached ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {purchaseStatusLabel(step)}
                </span>
              </div>
              {!isLast && (
                <span
                  className={cn(
                    'mx-1 h-px flex-1',
                    !isCancelled && i < currentIndex
                      ? 'bg-foreground'
                      : 'bg-border/70',
                  )}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
      {isCancelled && (
        <p className="text-xs text-rose-700 dark:text-rose-400">
          This order was cancelled.
        </p>
      )}
    </div>
  );
}
