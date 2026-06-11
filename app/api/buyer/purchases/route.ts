/**
 * Buyer purchases — GET (list) / POST (create request)
 *
 *   GET  /api/buyer/purchases
 *        → { purchases: BuyerPurchase[] } for the signed-in Clerk user.
 *
 *   POST /api/buyer/purchases
 *        body: { spaceId, serviceId?, title, amountCents?, notes? }
 *        → 201 { purchase } — opens a purchase request (status 'requested').
 *
 * Auth: requireAuth() (lib/api-auth) — same Clerk server helper the rest of the
 * app uses. The buyer's Clerk userId is the authorization key; we never trust a
 * client-supplied buyer id. All DB access goes through the service-role
 * Supabase client inside lib/buyer/purchases.
 */

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { requireAuth } from '@/lib/api-auth';
import {
  getPurchasesForUser,
  createPurchase,
  PurchaseValidationError,
} from '@/lib/buyer/purchases';

export const runtime = 'nodejs';

export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const purchases = await getPurchasesForUser(userId);
  return NextResponse.json({ purchases });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  let body: {
    spaceId?: unknown;
    serviceId?: unknown;
    title?: unknown;
    amountCents?: unknown;
    notes?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  // ── Validate spaceId ──────────────────────────────────────────────────────
  if (typeof body.spaceId !== 'string' || body.spaceId.trim().length === 0) {
    return NextResponse.json({ error: 'spaceId is required.' }, { status: 400 });
  }
  const spaceId = body.spaceId.trim().slice(0, 64);

  // ── Validate title ────────────────────────────────────────────────────────
  if (
    typeof body.title !== 'string' ||
    body.title.trim().length === 0 ||
    body.title.trim().length > 255
  ) {
    return NextResponse.json(
      { error: 'title is required (max 255 chars).' },
      { status: 400 },
    );
  }
  const title = body.title.trim();

  // ── Validate serviceId (optional) ─────────────────────────────────────────
  let serviceId: string | null = null;
  if (body.serviceId != null && body.serviceId !== '') {
    if (typeof body.serviceId !== 'string') {
      return NextResponse.json({ error: 'Invalid serviceId.' }, { status: 400 });
    }
    serviceId = body.serviceId.trim().slice(0, 64);
  }

  // ── Validate amountCents (optional) ───────────────────────────────────────
  let amountCents: number | null = null;
  if (body.amountCents != null && body.amountCents !== '') {
    const n =
      typeof body.amountCents === 'number'
        ? body.amountCents
        : parseInt(String(body.amountCents), 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000_00) {
      return NextResponse.json(
        { error: 'amountCents must be a non-negative integer (minor units).' },
        { status: 400 },
      );
    }
    amountCents = n;
  }

  // ── Validate notes (optional) ─────────────────────────────────────────────
  let notes: string | null = null;
  if (body.notes != null && body.notes !== '') {
    if (typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'Invalid notes.' }, { status: 400 });
    }
    notes = body.notes.slice(0, 4000);
  }

  // Denormalise the buyer's display identity from Clerk so the provider side
  // can show who requested without a join (mirrors SupportTicket).
  let buyerEmail: string | null = null;
  let buyerName: string | null = null;
  try {
    const user = await currentUser();
    if (user) {
      const primary = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId,
      );
      buyerEmail =
        primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      buyerName = name.length > 0 ? name : null;
    }
  } catch {
    // Non-fatal — the purchase is still keyed by buyerUserId. Display fields
    // are a convenience for the provider side.
  }

  try {
    const purchase = await createPurchase({
      buyerUserId: userId,
      buyerEmail,
      buyerName,
      spaceId,
      serviceId,
      title,
      amountCents,
      notes,
    });
    return NextResponse.json({ purchase }, { status: 201 });
  } catch (err) {
    if (err instanceof PurchaseValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
