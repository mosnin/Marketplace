import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * /auth/redirect?intent=provider|agency
 *
 * Called after Clerk sign-in from either login page.
 *
 * - intent=agency  → if the user is an agency_owner or agency_admin, go to /agency
 *                    otherwise fall back to the provider flow
 * - intent=provider → go to the user's workspace, or /setup if none yet
 * - no intent      → same as provider
 */
export default async function AuthRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/login/provider');

  const { intent } = await searchParams;

  // Look up the user row
  const { data: user } = await supabase
    .from('User')
    .select('id, accountType')
    .eq('clerkId', userId)
    .maybeSingle();

  if (!user) {
    // New user — check if they have a pending invitation before sending to setup.
    // This handles the case where Clerk's forceRedirectUrl didn't work and the
    // user ended up here after signing up for an agency invitation.
    try {
      const clerkUser = await currentUser();
      const email = clerkUser?.emailAddresses?.[0]?.emailAddress?.trim().toLowerCase();
      if (email) {
        const { data: pendingInvite } = await supabase
          .from('Invitation')
          .select('token')
          .eq('email', email)
          .eq('status', 'pending')
          .gt('expiresAt', new Date().toISOString())
          .order('createdAt', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pendingInvite?.token) {
          redirect(`/invite/${pendingInvite.token}`);
        }
      }
    } catch {
      // Non-blocking — fall through to setup if invite check fails
    }
    redirect('/setup');
  }

  // If user already has agency-level membership, always route to /agency.
  // This prevents invited agency_admin users from being pushed into setup/paywall
  // when they authenticate through non-agency entry points.
  const { data: agencyMembership } = await supabase
    .from('AgencyMembership')
    .select('id')
    .eq('userId', user.id)
    .in('role', ['agency_owner', 'agency_admin'])
    .maybeSingle();
  if (agencyMembership) {
    redirect('/agency');
  }

  // Agency-only users always go to /agency
  if (user.accountType === 'agency_only') {
    redirect('/agency');
  }

  if (intent === 'agency') {
    // Check for agency-level membership
    const { data: membership } = await supabase
      .from('AgencyMembership')
      .select('id, role')
      .eq('userId', user.id)
      .in('role', ['agency_owner', 'agency_admin'])
      .maybeSingle();

    if (membership) {
      redirect('/agency');
    }

    // They logged in via the agency page but don't have agency access yet.
    // Send them to the agency setup page so they can create or join one.
    redirect('/agency-setup');
  }

  // intent=provider (or no intent) — go to workspace or setup
  const { data: space } = await supabase
    .from('Space')
    .select('slug')
    .eq('ownerId', user.id)
    .maybeSingle();

  if (space?.slug) {
    redirect(`/s/${space.slug}`);
  }

  redirect('/setup');
}
