import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { getAgencyContext } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Agency-scoped Stripe Billing Portal session.
 *
 * The provider portal route (/api/billing/portal) is keyed to a Space the caller
 * OWNS — an agency managing the agency subscription needs the AGENCY's
 * Stripe customer instead. Auth mirrors the agency checkout branch:
 * getAgencyContext() + agency_owner only.
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

  // Prefer the Agency's own Stripe customer (agency-scoped checkout writes
  // it). Legacy agencies that subscribed through the owner's personal Space
  // fall back to that customer so the portal still opens for them.
  const { data: agency } = await supabase
    .from('Agency')
    .select('stripeCustomerId')
    .eq('id', ctx.agency.id)
    .maybeSingle();

  let customerId = (agency?.stripeCustomerId as string | null) ?? null;
  if (!customerId) {
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('stripeCustomerId')
      .eq('ownerId', ctx.agency.ownerId)
      .maybeSingle();
    customerId = (ownerSpace?.stripeCustomerId as string | null) ?? null;
  }

  if (!customerId) {
    return NextResponse.json(
      { error: 'No billing account found. Subscribe first.' },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://my.usekoala.com';

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/agency/billing`,
  });

  return NextResponse.json({ url: session.url });
}
