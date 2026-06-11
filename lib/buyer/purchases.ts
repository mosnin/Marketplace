/**
 * Buyer-side data access — the "my purchases" layer for the Koala marketplace.
 *
 * A buyer signs in with the SAME Clerk instance as providers; their Clerk user
 * id is the authorization key (`Purchase.buyerUserId`). Every function here is
 * scoped to a single Clerk user id — the caller resolves that from the Clerk
 * session (server-side) and passes it in, so this module never trusts a
 * client-supplied id. All access goes through the service-role Supabase client
 * (see lib/supabase.ts), the same posture as the rest of the app; tenant
 * isolation is enforced here in application code by filtering on `buyerUserId`
 * (DB_CONVENTIONS.md §7).
 *
 * The provider side of a purchase (the Space it was bought from, the catalog
 * Service, the scheduled Appointment) is denormalised on read into a small
 * display shape (PurchaseWithProvider — see lib/buyer/types.ts) so the buyer
 * pages never need to know the provider table layout. Joins use PostgREST
 * embedded resources with explicit FK constraint names.
 */

import { supabase } from '@/lib/supabase';
import {
  ACTIVE_PURCHASE_STATUSES,
  type PurchaseStatus,
  type PurchaseAppointment,
  type PurchaseProvider,
  type PurchaseWithProvider,
} from '@/lib/buyer/types';

// Re-export the shared types/constants so route + page + component callers can
// import data shape and data access from one module.
export {
  ACTIVE_PURCHASE_STATUSES,
  PURCHASE_TIMELINE,
  PURCHASE_STATUS_LABELS,
} from '@/lib/buyer/types';
export type {
  Purchase,
  PurchaseStatus,
  PurchaseProvider,
  PurchaseService,
  PurchaseAppointment,
  PurchaseWithProvider,
  BuyerStats,
} from '@/lib/buyer/types';

// PostgREST embedded-resource select. The FK constraint is named in each embed
// so PostgREST resolves the right relationship unambiguously (Purchase has a
// single FK to each of Space / Service / Appointment). Postgres auto-names an
// inline-REFERENCES constraint `{table}_{column}_fkey`, matching the
// CommissionLedger embed pattern elsewhere in the app.
const SELECT_WITH_RELATIONS = `
  id, buyerUserId, buyerEmail, buyerName, spaceId, serviceId, appointmentId,
  title, amountCents, currency, status, notes, createdAt, updatedAt,
  provider:Space!Purchase_spaceId_fkey ( id, name, slug, emoji ),
  service:Service!Purchase_serviceId_fkey ( id, address, city, stateRegion, serviceType, listPrice ),
  appointment:Appointment!Purchase_appointmentId_fkey ( id, startsAt, endsAt, status, serviceAddress )
`;

// PostgREST returns embedded one-to-one resources as either an object or a
// single-element array depending on how the relationship is inferred. Normalise
// to "first object or null" so callers get a stable shape.
function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapRow(row: Record<string, unknown>): PurchaseWithProvider {
  return {
    id: row.id as string,
    buyerUserId: row.buyerUserId as string,
    buyerEmail: (row.buyerEmail as string | null) ?? null,
    buyerName: (row.buyerName as string | null) ?? null,
    spaceId: row.spaceId as string,
    serviceId: (row.serviceId as string | null) ?? null,
    appointmentId: (row.appointmentId as string | null) ?? null,
    title: row.title as string,
    amountCents: (row.amountCents as number | null) ?? null,
    currency: (row.currency as string) ?? 'usd',
    status: row.status as PurchaseStatus,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    provider: firstOrNull(row.provider as PurchaseProvider | PurchaseProvider[] | null),
    service: firstOrNull(
      row.service as PurchaseWithProvider['service'] | PurchaseWithProvider['service'][] | null,
    ),
    appointment: firstOrNull(
      row.appointment as PurchaseAppointment | PurchaseAppointment[] | null,
    ),
  };
}

/**
 * Every purchase for a Clerk user, newest-first. Scoped to `buyerUserId` —
 * never returns another buyer's rows.
 */
export async function getPurchasesForUser(
  buyerUserId: string,
): Promise<PurchaseWithProvider[]> {
  const { data, error } = await supabase
    .from('Purchase')
    .select(SELECT_WITH_RELATIONS)
    .eq('buyerUserId', buyerUserId)
    .order('createdAt', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

/**
 * A single purchase by id, scoped to the owning buyer. Returns null when the
 * id doesn't exist OR belongs to a different buyer — callers treat null as
 * 404, so a buyer can never probe another buyer's purchase ids.
 */
export async function getPurchase(
  buyerUserId: string,
  purchaseId: string,
): Promise<PurchaseWithProvider | null> {
  const { data, error } = await supabase
    .from('Purchase')
    .select(SELECT_WITH_RELATIONS)
    .eq('id', purchaseId)
    .eq('buyerUserId', buyerUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

/** An upcoming appointment surfaced on the dashboard, carrying the originating
 *  purchase so the row can link back to its detail page. */
export interface UpcomingAppointment extends PurchaseAppointment {
  provider: PurchaseProvider | null;
  purchaseId: string;
  purchaseTitle: string;
}

/**
 * Upcoming scheduled appointments linked to this buyer's purchases. Reads the
 * appointments off the buyer's purchases, then keeps the future, non-cancelled
 * ones — soonest-first. Used by the dashboard.
 */
export async function getUpcomingAppointmentsForUser(
  buyerUserId: string,
  limit = 5,
): Promise<UpcomingAppointment[]> {
  const purchases = await getPurchasesForUser(buyerUserId);
  const nowMs = Date.now();

  return purchases
    .filter(
      (p): p is PurchaseWithProvider & { appointment: PurchaseAppointment } =>
        p.appointment != null &&
        p.status !== 'cancelled' &&
        p.appointment.status !== 'cancelled' &&
        p.appointment.startsAt != null &&
        new Date(p.appointment.startsAt).getTime() >= nowMs,
    )
    .sort(
      (a, b) =>
        new Date(a.appointment.startsAt as string).getTime() -
        new Date(b.appointment.startsAt as string).getTime(),
    )
    .slice(0, limit)
    .map((p) => ({
      ...p.appointment,
      provider: p.provider,
      purchaseId: p.id,
      purchaseTitle: p.title,
    }));
}

/** Aggregate dashboard numbers for a buyer, computed from their purchases. */
export function computeBuyerStats(
  purchases: PurchaseWithProvider[],
  upcomingCount: number,
): import('@/lib/buyer/types').BuyerStats {
  const activePurchases = purchases.filter((p) =>
    (ACTIVE_PURCHASE_STATUSES as readonly string[]).includes(p.status),
  ).length;

  // Total spent counts completed orders only — money the buyer has actually
  // settled, not in-flight requests that may still change or be cancelled.
  const totalSpentCents = purchases
    .filter((p) => p.status === 'completed' && p.amountCents != null)
    .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);

  return {
    activePurchases,
    upcomingAppointments: upcomingCount,
    totalSpentCents,
  };
}

export interface CreatePurchaseInput {
  buyerUserId: string;
  buyerEmail?: string | null;
  buyerName?: string | null;
  spaceId: string;
  serviceId?: string | null;
  title: string;
  amountCents?: number | null;
  notes?: string | null;
}

/**
 * Create a purchase REQUEST (status defaults to 'requested' in the DB). The
 * route layer validates the body and resolves `buyerUserId` from the Clerk
 * session before calling this. We verify the referenced Space exists (and that
 * the Service, when supplied, belongs to that Space) so a buyer can't open a
 * request against a non-existent provider or graft another provider's service
 * onto this Space. Returns the created row in the standard denormalised shape.
 */
export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<PurchaseWithProvider> {
  // Verify the target Space exists. The marketplace surfaces real Spaces, but
  // the request still has to be authoritative.
  const { data: space, error: spaceErr } = await supabase
    .from('Space')
    .select('id')
    .eq('id', input.spaceId)
    .maybeSingle();
  if (spaceErr) throw spaceErr;
  if (!space) throw new PurchaseValidationError('Provider not found.');

  // Verify the service (when supplied) belongs to the same Space.
  let serviceId: string | null = null;
  if (input.serviceId) {
    const { data: service, error: serviceErr } = await supabase
      .from('Service')
      .select('id')
      .eq('id', input.serviceId)
      .eq('spaceId', input.spaceId)
      .maybeSingle();
    if (serviceErr) throw serviceErr;
    if (!service) throw new PurchaseValidationError('Service not found for this provider.');
    serviceId = service.id as string;
  }

  const { data, error } = await supabase
    .from('Purchase')
    .insert({
      buyerUserId: input.buyerUserId,
      buyerEmail: input.buyerEmail ?? null,
      buyerName: input.buyerName ?? null,
      spaceId: input.spaceId,
      serviceId,
      title: input.title,
      amountCents: input.amountCents ?? null,
      notes: input.notes ?? null,
      // status defaults to 'requested', currency to 'usd' at the DB level.
    })
    .select(SELECT_WITH_RELATIONS)
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

/** Thrown by createPurchase on a bad reference (unknown Space / Service). The
 *  route maps it to a 400; everything else bubbles as a 500. */
export class PurchaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseValidationError';
  }
}
