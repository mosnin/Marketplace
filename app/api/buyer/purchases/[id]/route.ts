/**
 * Buyer purchase detail — GET /api/buyer/purchases/[id]
 *
 * Returns a single purchase scoped to the signed-in Clerk user. getPurchase
 * filters by buyerUserId, so a buyer requesting an id they don't own gets a
 * 404 — they can never probe another buyer's purchases.
 *
 * Auth: requireAuth() (lib/api-auth) — the same Clerk server helper used by the
 * rest of the app. DB access uses the service-role Supabase client inside
 * lib/buyer/purchases.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getPurchase } from '@/lib/buyer/purchases';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  const purchase = await getPurchase(userId, id);
  if (!purchase) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ purchase });
}
