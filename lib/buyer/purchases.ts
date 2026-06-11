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
 * display shape so the buyer pages never need to know the provider table
 * layout. Joins use PostgREST embedded resources with explicit FK columns.
 */

import { supabase } from '@/lib/supabase';

/** The fulfilment lifecycle a Purchase moves through. Mirrors the CHECK
 *  constraint in supabase/migrations/20260611200000_buyer_marketplace.sql. */
export type PurchaseStatus =
  | 'requested'
  | 'confirmed'
  | 'in_progress'
  | 'delivered'
  | 'completed'
  | 'cancelled';

/** Ordered happy-path lifecycle (excludes the terminal `cancelled`). Used to
 *  render the status timeline on the purchases + detail pages. */
export const PURCHASE_LIFECYCLE: PurchaseStatus[] = [
  'requested',
  'confirmed',
  'in_progress',
  'delivered',
  'completed',
];

/** Statuses that count as "active" (open work) for the dashboard stat —
 *  everything that isn't a terminal completed/cancelled. */
export const ACTIVE_PURCHASE_STATUSES: PurchaseStatus[] = [
  'requested',
  'confirmed',
  'in_progress',
  'delivered',
];

/** Minimal provider-Space shape surfaced to the buyer UI. */
export interface PurchaseSpace {
  id: string;
  slug: string;
  name: string;
  emoji: string;
}

/** Minimal catalog-Service shape surfaced to the buyer UI. */
export interface PurchaseService {
  id: string;
  address: string;
  city: string | null;
  stateRegion: string | null;
  serviceType: string | null;
  listPrice: number | null;
}

/** Minimal scheduled-Appointment shape surfaced to the buyer UI. */
export interface PurchaseAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  serviceAddress: string | null;
}

/** A buyer's purchase with its linked provider entities denormalised. */
export interface BuyerPurchase {
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
  space: PurchaseSpace | null;
  service: PurchaseService | null;
  appointment: PurchaseAppointment | null;
}

// PostgREST embedded-resource select. The FK column is named in the embed so
// PostgREST resolves the right relationship unambiguously (Purchase has a
// single FK to each of Space / Service / Appointment).
const SELECT_WITH_RELATIONS = `
  id, buyerUserId, buyerEmail, buyerName, spaceId, serviceId, appointmentId,
  title, amountCents, currency, status, notes, createdAt, updatedAt,
  space:Space!Purchase_spaceId_fkey ( id, slug, name, emoji ),
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

function mapRow(row: Record<string, unknown>): BuyerPurchase {
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
    space: firstOrNull(row.space as PurchaseSpace | PurchaseSpace[] | null),
    service: firstOrNull(row.service as PurchaseService | PurchaseService[] | null),
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
): Promise<BuyerPurchase[]> {
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
): Promise<BuyerPurchase | null> {
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

/** Upcoming scheduled appointments linked to this buyer's purchases. Reads the
 *  appointment ids off the buyer's purchases, then fetches the future,
 *  non-cancelled appointments — soonest-first. Used by the dashboard. */
export async function getUpcomingAppointmentsForUser(
  buyerUserId: string,
  limit = 5,
): Promise<(PurchaseAppointment & { space: PurchaseSpace | null; purchaseId: string; purchaseTitle: string })[]> {
  const purchases = await getPurchasesForUser(buyerUserId);
  const withAppt = purchases.filter(
    (p): p is BuyerPurchase & { appointment: PurchaseAppointment } =>
      p.appointment != null && p.status !== 'cancelled',
  );

  const nowMs = Date.now();
  return withAppt
    .filter(
      (p) =>
        p.appointment.status !== 'cancelled' &&
        new Date(p.appointment.startsAt).getTime() >= nowMs,
    )
    .sort(
      (a, b) =>
        new Date(a.appointment.startsAt).getTime() -
        new Date(b.appointment.startsAt).getTime(),
    )
    .slice(0, limit)
    .map((p) => ({
      ...p.appointment,
      space: p.space,
      purchaseId: p.id,
      purchaseTitle: p.title,
    }));
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
): Promise<BuyerPurchase> {
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
 *  route maps it to a 400/404; everything else bubbles as a 500. */
export class PurchaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseValidationError';
  }
}
