/**
 * Buyer-side types — the marketplace consumer surface.
 *
 * A `Purchase` is the buyer's record of buying/booking a provider service.
 * The `PurchaseWithProvider` shape is the read model used by the buyer
 * dashboard / history / detail pages: it joins the originating provider
 * `Space` (name + slug + emoji), the optional catalog `Service`, and the
 * optional linked `Appointment` so a page can render everything without
 * issuing follow-up queries.
 */

/** The fulfilment lifecycle, in order. `cancelled` is terminal/off-path. */
export const PURCHASE_STATUSES = [
  'requested',
  'confirmed',
  'in_progress',
  'delivered',
  'completed',
  'cancelled',
] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/**
 * The happy-path timeline a buyer progresses through, in order. `cancelled`
 * is deliberately excluded — it's an off-path terminal state, not a step.
 */
export const PURCHASE_TIMELINE: readonly PurchaseStatus[] = [
  'requested',
  'confirmed',
  'in_progress',
  'delivered',
  'completed',
] as const;

/**
 * Statuses that count as "active" (open work) for the dashboard stat — every
 * non-terminal state (i.e. not completed, not cancelled).
 */
export const ACTIVE_PURCHASE_STATUSES: readonly PurchaseStatus[] = [
  'requested',
  'confirmed',
  'in_progress',
  'delivered',
] as const;

/** Human-facing label for a status chip / timeline node. */
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Raw row, mirrors the "Purchase" table. */
export interface Purchase {
  id: string;
  buyerUserId: string;
  buyerEmail: string | null;
  buyerName: string | null;
  spaceId: string;
  serviceId: string | null;
  appointmentId: string | null;
  title: string;
  amountCents: number | null;
  currency: string;
  status: PurchaseStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Provider (Space) summary attached to a purchase for display. */
export interface PurchaseProvider {
  id: string;
  name: string | null;
  slug: string | null;
  emoji: string | null;
}

/** Catalog service summary attached to a purchase, when linked. */
export interface PurchaseService {
  id: string;
  address: string | null;
  city: string | null;
  stateRegion: string | null;
  serviceType: string | null;
  listPrice: number | null;
}

/** Appointment summary attached to a purchase, when scheduled. */
export interface PurchaseAppointment {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
  serviceAddress: string | null;
}

/** The read model used by buyer pages. */
export interface PurchaseWithProvider extends Purchase {
  provider: PurchaseProvider | null;
  service: PurchaseService | null;
  appointment: PurchaseAppointment | null;
}

/** Aggregated numbers for the dashboard stat strip. */
export interface BuyerStats {
  /** Purchases that are neither completed nor cancelled. */
  activePurchases: number;
  /** Linked appointments with a future start time. */
  upcomingAppointments: number;
  /** Sum of amountCents across non-cancelled purchases, in minor units. */
  totalSpentCents: number;
}
