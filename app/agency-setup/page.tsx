import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getAgencyContext } from '@/lib/permissions';
import { AgencySetupClient } from './agency-setup-client';

export const metadata = { title: 'Agency — Koala' };

/**
 * /agency-setup setup page.
 * - If already an agency: redirect to /agency
 * - If not onboarded: redirect to /setup
 * - Otherwise: show create/join options
 */
export default async function AgencyPage() {
  const { userId } = await auth();
  if (!userId) redirect('/login/provider');

  const { data: user } = await supabase
    .from('User')
    .select('id, onboard')
    .eq('clerkId', userId)
    .maybeSingle();

  if (!user) redirect('/setup');
  if (!user.onboard) redirect('/setup');

  const { data: space } = await supabase
    .from('Space')
    .select('slug')
    .eq('ownerId', user.id)
    .maybeSingle();

  if (!space) redirect('/setup');

  // Already an agency? Go straight to the agency dashboard
  let existingAgencyName: string | null = null;
  let existingAgencyId: string | null = null;
  try {
    const ctx = await getAgencyContext();
    if (ctx) {
      existingAgencyName = ctx.agency.name;
      existingAgencyId = ctx.agency.id;
    }
  } catch {
    // non-blocking
  }

  // Already a provider_member? Also redirect
  if (!existingAgencyName) {
    const { data: membership } = await supabase
      .from('AgencyMembership')
      .select('agencyId')
      .eq('userId', user.id)
      .eq('role', 'provider_member')
      .maybeSingle();
    if (membership) {
      const { data: agency } = await supabase
        .from('Agency')
        .select('name')
        .eq('id', membership.agencyId)
        .maybeSingle();
      existingAgencyName = agency?.name ?? 'Your agency';
      existingAgencyId = membership.agencyId;
    }
  }

  return (
    <AgencySetupClient
      spaceSlug={space.slug}
      existingAgencyName={existingAgencyName}
      existingAgencyId={existingAgencyId}
    />
  );
}
