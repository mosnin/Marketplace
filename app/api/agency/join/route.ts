import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { checkSeatCapacity } from '@/lib/agency-seats';
import { notifyAgency } from '@/lib/agency-notify';
import { notificationForMemberJoined } from '@/lib/notification-voice';

/**
 * POST /api/agency/join
 * Join an agency using its invite code.
 * Any authenticated, onboarded user can join. Assigns role: provider_member.
 *
 * Uses requireAuth (not raw Clerk auth()) so the offboarding gate fires —
 * an offboarded user clicking an old join-code link must NOT be able to
 * silently re-onboard themselves. Re-hire happens via an explicit
 * /api/invitations/[token] flow, which is the only path that intentionally
 * revives an offboarded User row.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: clerkId } = authResult;

  // 10 join attempts per user per hour (prevents code enumeration)
  const { allowed } = await checkRateLimit(`agency:join:${clerkId}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  let code: string;
  try {
    ({ code } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const normalizedCode = (code ?? '').trim().toUpperCase();
  if (!normalizedCode) {
    return NextResponse.json({ error: 'Invite code required' }, { status: 400 });
  }

  // Resolve current user
  const { data: user } = await supabase
    .from('User')
    .select('id, onboard')
    .eq('clerkId', clerkId)
    .maybeSingle();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (!user.onboard) return NextResponse.json({ error: 'Complete onboarding before joining an agency' }, { status: 403 });

  // Find agency by code
  const { data: agency } = await supabase
    .from('Agency')
    .select('id, name, status')
    .eq('joinCode', normalizedCode)
    .maybeSingle();

  if (!agency) {
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
  }

  if (agency.status === 'suspended') {
    return NextResponse.json({ error: 'This agency is currently suspended' }, { status: 403 });
  }

  // Idempotent: already a member?
  const { data: existing } = await supabase
    .from('AgencyMembership')
    .select('id, role')
    .eq('agencyId', agency.id)
    .eq('userId', user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ agencyName: agency.name, alreadyMember: true }, { status: 200 });
  }

  // Deny-list check. If this user was previously removed from this
  // agency, the anonymous code path is closed — the only way back
  // in is an explicit /api/invitations/[token] acceptance from a
  // agency_owner or agency_admin. A removed agent re-clicking the
  // join URL they kept in their email gets a clear 403; the agency
  // doesn't get a silent member_joined notification for someone they
  // already fired.
  const { data: removalRow } = await supabase
    .from('AgencyRemoval')
    .select('agencyId')
    .eq('agencyId', agency.id)
    .eq('userId', user.id)
    .maybeSingle();
  if (removalRow) {
    return NextResponse.json(
      { error: 'Your access to this agency was removed. Ask the agency to re-invite you by email.' },
      { status: 403 },
    );
  }

  // Seat cap — the invite paths enforce checkSeatCapacity, but self-join via the
  // (static, shareable) code did not, so anyone with the code could add
  // themselves past the plan's paid seat limit. Gate it the same way.
  const seat = await checkSeatCapacity(agency.id, 1);
  if (!seat.ok) {
    return NextResponse.json(
      { error: 'This agency has reached its seat limit. Ask the agency to add seats or remove a member.' },
      { status: 402 },
    );
  }

  // Create membership
  const { error: memberErr } = await supabase
    .from('AgencyMembership')
    .insert({ agencyId: agency.id, userId: user.id, role: 'provider_member' });

  if (memberErr) {
    console.error('[agency/join] membership insert failed', memberErr);
    return NextResponse.json({ error: 'Failed to join agency' }, { status: 500 });
  }

  // Adopt this agency's intake form-config ONLY if the Space isn't already
  // linked. Membership (above) is the source of truth for access; Space.agencyId
  // is just the intake-config owner — and a provider who belongs to agency A
  // joining agency B must NOT have B silently steal their workspace. Set it
  // only when currently NULL; never overwrite an existing link.
  const { data: space } = await supabase
    .from('Space')
    .select('id, agencyId')
    .eq('ownerId', user.id)
    .maybeSingle();
  if (space && !space.agencyId) {
    await supabase.from('Space').update({ agencyId: agency.id }).eq('id', space.id);
  }

  void audit({ actorClerkId: clerkId, action: 'CREATE', resource: 'AgencyMembership', metadata: { agencyId: agency.id, role: 'provider_member', method: 'join_code' } });

  // Resolve user email for notification
  const { data: userData } = await supabase.from('User').select('email').eq('id', user.id).maybeSingle();
  const joinCopy = notificationForMemberJoined(
    userData?.email ?? 'A new member',
    'provider_member',
    'join_code',
  );
  void notifyAgency({
    agencyId: agency.id,
    type: 'member_joined',
    title: joinCopy.title,
    body: joinCopy.description,
    metadata: { userId: user.id, method: 'join_code' },
  });

  return NextResponse.json({ agencyName: agency.name }, { status: 201 });
}
