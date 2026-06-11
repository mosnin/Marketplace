import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

/**
 * POST /api/agency/create
 * Self-serve agency creation. Any authenticated, onboarded provider can create
 * one agency. Enforced by the UNIQUE index on Agency.ownerId.
 */
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 3 attempts per user per day
  const { allowed } = await checkRateLimit(`agency:create:${clerkId}`, 3, 86400);
  if (!allowed) return NextResponse.json({ error: 'Too many attempts. Try again tomorrow.' }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, logoUrl, websiteUrl, officeAddress, officePhone, agentCount, agencyType, primaryMarket, commissionStructure, geographicCoverage } = body as {
    name?: string;
    logoUrl?: string;
    websiteUrl?: string;
    officeAddress?: string;
    officePhone?: string;
    agentCount?: string;
    agencyType?: string;
    primaryMarket?: string;
    commissionStructure?: string;
    geographicCoverage?: string;
  };

  const trimmedName = (typeof name === 'string' ? name : '').trim();
  if (!trimmedName || trimmedName.length > 120) {
    return NextResponse.json({ error: 'Agency name required (max 120 chars)' }, { status: 400 });
  }

  // Validate enum fields
  const validAgencyTypes = ['independent', 'franchise', 'virtual'];
  const validMarkets = ['residential_rental', 'commercial', 'mixed'];
  const validCommissions = ['flat_fee', 'percentage_split', 'hybrid'];
  if (agencyType && !validAgencyTypes.includes(agencyType)) {
    return NextResponse.json({ error: `Invalid agencyType. Must be one of: ${validAgencyTypes.join(', ')}` }, { status: 400 });
  }
  if (primaryMarket && !validMarkets.includes(primaryMarket)) {
    return NextResponse.json({ error: `Invalid primaryMarket. Must be one of: ${validMarkets.join(', ')}` }, { status: 400 });
  }
  if (commissionStructure && !validCommissions.includes(commissionStructure)) {
    return NextResponse.json({ error: `Invalid commissionStructure. Must be one of: ${validCommissions.join(', ')}` }, { status: 400 });
  }

  // Resolve internal user id
  const { data: user, error: userErr } = await supabase
    .from('User')
    .select('id, onboard, accountType, platformRole')
    .eq('clerkId', clerkId)
    .maybeSingle();
  if (userErr || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Platform admins bypass the onboarding/account-type gates below. An admin is
  // usually a provider who was promoted, so their accountType is 'provider' — which
  // was tripping the "upgrade to an agency account" 403 and blocking them from
  // creating agencies at all. Admins are superusers; let them through.
  const isAdmin = user.platformRole === 'admin';

  // Agency-only users are marked onboard during setup even without a Space
  if (!user.onboard && !isAdmin) return NextResponse.json({ error: 'Complete onboarding first' }, { status: 403 });
  // Only users who selected agency role during onboarding can create an agency
  if (user.accountType === 'provider' && !isAdmin) {
    return NextResponse.json({ error: 'Upgrade to an agency account to create an agency' }, { status: 403 });
  }

  // Check: does this user already own an agency?
  const { data: existing } = await supabase
    .from('Agency')
    .select('id')
    .eq('ownerId', user.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: 'You already own an agency' }, { status: 409 });

  // Direct inserts instead of RPC — avoids ambiguous function overload issues
  // when multiple versions of create_agency_with_owner exist in the database.
  const agencyId = crypto.randomUUID();

  const { data: agency, error: insertErr } = await supabase
    .from('Agency')
    .insert({
      id: agencyId,
      name: trimmedName,
      ownerId: user.id,
      ...(logoUrl && { logoUrl: String(logoUrl).slice(0, 500) }),
      ...(websiteUrl && { websiteUrl: String(websiteUrl).slice(0, 500) }),
      ...(officeAddress && { officeAddress: String(officeAddress).slice(0, 500) }),
      ...(officePhone && { officePhone: String(officePhone).slice(0, 40) }),
      ...(agentCount && { agentCount: String(agentCount).slice(0, 20) }),
      ...(agencyType && { agencyType }),
      ...(primaryMarket && { primaryMarket }),
      ...(commissionStructure && { commissionStructure }),
      ...(geographicCoverage && { geographicCoverage: String(geographicCoverage).slice(0, 500) }),
    })
    .select()
    .single();

  if (insertErr) {
    // Check if user already owns an agency (race condition with unique index)
    const errMsg = insertErr.message || '';
    if (errMsg.includes('duplicate key') || errMsg.includes('unique') || insertErr.code === '23505') {
      return NextResponse.json({ error: 'You already own an agency' }, { status: 409 });
    }
    console.error('[agency/create] Agency insert failed:', insertErr);
    return NextResponse.json({ error: 'Failed to create agency' }, { status: 500 });
  }

  // Create the owner membership
  const { error: membershipErr } = await supabase
    .from('AgencyMembership')
    .insert({
      id: crypto.randomUUID(),
      agencyId,
      userId: user.id,
      role: 'agency_owner',
    });

  if (membershipErr) {
    console.error('[agency/create] AgencyMembership insert failed:', membershipErr);
    // Rollback: delete the agency we just created since it's unusable without an owner membership
    await supabase.from('Agency').delete().eq('id', agencyId);
    return NextResponse.json({ error: 'Failed to create agency membership' }, { status: 500 });
  }

  void audit({ actorClerkId: clerkId, action: 'CREATE', resource: 'Agency', resourceId: agencyId, metadata: { name: trimmedName } });

  return NextResponse.json({ agency }, { status: 201 });
}
