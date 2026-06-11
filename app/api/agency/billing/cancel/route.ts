import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { getAgencyContext } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Agency-scoped subscription cancel (at period end).
 *
 * Mirrors /api/billing/cancel but targets the AGENCY's subscription, not a
 * Space the caller owns. Same auth as the agency checkout branch:
 * getAgencyContext() + agency_owner only. The webhook keeps DB status in sync
 * when the cancellation lands.
 */
export async function POST() {
  const ctx = await getAgencyContext();
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (ctx.membership.role !== 'agency_owner') {
    return NextResponse.json(
      { error: 'Only the agency owner can manage billing.' },
      { status: 403 },
    );
  }

  const { allowed } = await checkRateLimit(`billing:agency:${ctx.dbUserId}`, 5, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // Agency subscription first; legacy owner-space subscription as fallback.
  const { data: agency } = await supabase
    .from('Agency')
    .select('stripeSubscriptionId')
    .eq('id', ctx.agency.id)
    .maybeSingle();

  let subscriptionId = (agency?.stripeSubscriptionId as string | null) ?? null;
  if (!subscriptionId) {
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('stripeSubscriptionId')
      .eq('ownerId', ctx.agency.ownerId)
      .maybeSingle();
    subscriptionId = (ownerSpace?.stripeSubscriptionId as string | null) ?? null;
  }

  if (!subscriptionId) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
  }

  const stripe = getStripe();

  // Cancel at end of billing period (not immediately) — same policy as the
  // provider cancel route.
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  return NextResponse.json({ ok: true });
}
