'use client';

/**
 * Agency kanban column.
 *
 * Mirrors the provider KanbanColumn header and drop-zone look exactly:
 * stage-color dot + name + count + compact value total. The differences
 * from the provider version:
 *
 *  - No drag handle (no column reorder).
 *  - No quick-add input (the agency doesn't create provider deals).
 *  - No delete-stage button.
 *  - Renders AgencyDealCard instead of DealCard.
 *
 * AnimatePresence wraps cards for clean enter/exit, matching the
 * provider board's behavior.
 */

import { AnimatePresence } from 'framer-motion';
import { AgencyDealCard, type AgencyDealItem } from './agency-deal-card';
import { formatCompact } from '@/lib/formatting';
import { cn } from '@/lib/utils';

interface AgencyKanbanColumnProps {
  stageId: string;
  stageName: string;
  stageColor: string;
  deals: AgencyDealItem[];
  onOpenDeal: (deal: AgencyDealItem) => void;
}

export function AgencyKanbanColumn({
  stageName,
  stageColor,
  deals,
  onOpenDeal,
}: AgencyKanbanColumnProps) {
  const totalValue = deals.reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div className="flex flex-col w-72 flex-shrink-0">
      {/* Column header — mirrors provider KanbanColumn header exactly */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: stageColor }}
            aria-hidden
          />
          <span className="text-base font-semibold text-foreground truncate">
            {stageName}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {deals.length}
          </span>
        </div>
        {totalValue > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatCompact(totalValue)}
          </span>
        )}
      </div>

      {/* Drop zone look — same class structure as the provider column */}
      <div
        className={cn(
          'flex-1 min-h-24 rounded-lg p-2',
          'bg-foreground/[0.02] border border-border/70',
        )}
      >
        <AnimatePresence>
          {deals.map((deal, idx) => (
            <AgencyDealCard
              key={deal.id}
              deal={deal}
              entranceIndex={idx}
              onClick={onOpenDeal}
            />
          ))}
        </AnimatePresence>
        {deals.length === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground/40">
            <p className="text-xs">No deals</p>
          </div>
        )}
      </div>
    </div>
  );
}
