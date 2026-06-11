import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { getAgencyMemberContext } from '@/lib/permissions';
import { Sidebar } from '@/components/dashboard/sidebar';
import { SidebarCollapseProvider } from '@/components/dashboard/sidebar-collapse';
import { MobileNav } from '@/components/dashboard/mobile-nav';
import { Header } from '@/components/dashboard/header';
import { AccountSwitchSwipe } from '@/components/dashboard/account-switch';
import { AgencyMain } from '@/components/agency/agency-main';
import { supabase } from '@/lib/supabase';
import { getAgencyMembers } from '@/lib/agency-members';
import { KoalaSplash } from '@/components/dashboard/koala-splash';
import { pickGreeting } from '@/lib/greetings';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Teams — Koala' };

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect('/login/provider');

  const ctx = await getAgencyMemberContext();

  // Not an agency — redirect to the setup page
  if (!ctx) {
    redirect('/setup');
  }

  // Look up their provider workspace (may not exist for agency-only accounts)
  const { data: spaceRow } = await supabase
    .from('Space')
    .select('id, slug, name')
    .eq('ownerId', ctx.dbUserId)
    .maybeSingle();

  // Check if this is an agency-only account (no personal workspace)
  const { data: userRow } = await supabase
    .from('User')
    .select('accountType, platformRole')
    .eq('id', ctx.dbUserId)
    .maybeSingle();

  const isAgencyOnly = userRow?.accountType === 'agency_only';
  const isPlatformAdmin = userRow?.platformRole === 'admin';

  // If they have no space and are NOT agency-only, send to setup
  if (!spaceRow && !isAgencyOnly) {
    redirect('/setup');
  }

  const slug = spaceRow?.slug as string ?? '';
  const spaceName = (spaceRow?.name as string) ?? ctx.agency.name;

  // Subscription gate — redirect to standalone pages
  // Only exempt billing/settings paths for users with subscription history;
  // users with NO subscription history should always be redirected to /subscribe.
  const agencyHeaders = await headers();
  const agencyPath = agencyHeaders.get('x-pathname')
    || agencyHeaders.get('x-invoke-path')
    || agencyHeaders.get('x-matched-path')
    || agencyHeaders.get('next-url')
    || '';
  const isBillingOrSettings =
    agencyPath.includes('/billing') ||
    agencyPath.includes('/settings');

  const isOwnerOfAgency = ctx.agency.ownerId === ctx.dbUserId;

  if (!isPlatformAdmin && isOwnerOfAgency) {
    // Only the agency OWNER is gated by subscription.
    // Invited admins and members access the agency dashboard for free —
    // billing is the owner's responsibility.
    if (spaceRow) {
      try {
        const { data: subData, error: subError } = await supabase
          .from('Space')
          .select('stripeSubscriptionStatus, stripeSubscriptionId, trialUsedAt')
          .eq('id', spaceRow.id)
          .maybeSingle();

        if (subError) {
          console.error('[agency-layout] Subscription check query failed:', subError);
          redirect(`/subscribe?slug=${slug}`);
        }

        const hasSubscriptionHistory = !!(subData?.stripeSubscriptionId || subData?.trialUsedAt);
        // Only exempt billing/settings for users with subscription history
        const isAgencyExempt = isBillingOrSettings && hasSubscriptionHistory;

        const status = subData?.stripeSubscriptionStatus ?? 'inactive';
        if (status !== 'active' && status !== 'trialing' && !isAgencyExempt) {
          if (hasSubscriptionHistory) {
            redirect(`/billing-required?slug=${slug}&reason=${status}`);
          }
          redirect(`/subscribe?slug=${slug}`);
        }
      } catch (err: any) {
        // Next.js redirect() throws a special error — re-throw it
        if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
        console.error('[agency-layout] Subscription gate error:', err);
        redirect(`/subscribe?slug=${slug}`);
      }
    } else if (isAgencyOnly) {
      // Agency-only owner without a personal space — check via owner's space
      try {
        const { data: ownerSpace } = await supabase
          .from('Space')
          .select('slug, stripeSubscriptionStatus, stripeSubscriptionId, trialUsedAt')
          .eq('ownerId', ctx.agency.ownerId)
          .maybeSingle();

        if (ownerSpace) {
          const ownerStatus = ownerSpace.stripeSubscriptionStatus ?? 'inactive';
          const ownerSlug = ownerSpace.slug ?? '';
          const ownerHasHistory = !!(ownerSpace.stripeSubscriptionId || ownerSpace.trialUsedAt);
          const isAgencyOnlyExempt = isBillingOrSettings && ownerHasHistory;

          if (ownerStatus !== 'active' && ownerStatus !== 'trialing' && !isAgencyOnlyExempt) {
            if (ownerHasHistory) {
              redirect(`/billing-required?slug=${ownerSlug}&reason=${ownerStatus}`);
            }
            redirect(`/subscribe?slug=${ownerSlug}`);
          }
        }
        // agency_only without personal space — skip subscription gate entirely.
        // These users have no Space to check against; they manage the agency
        // without needing a personal subscription.
      } catch (err: any) {
        if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
        console.error('[agency-layout] Agency-only owner subscription check error:', err);
        // Don't redirect agency_only users without a space to /subscribe —
        // they have no slug and the subscription wall doesn't apply to them.
      }
    } else {
      // No space and not agency-only — shouldn't be here
      redirect('/setup');
    }
  }

  // ── Agency's first name (for greeting) ────────────────────────────────────
  let agencyFirstName = '';
  try {
    const { data: agencyUserRow } = await supabase
      .from('User')
      .select('name')
      .eq('id', ctx.dbUserId)
      .maybeSingle();
    agencyFirstName = (agencyUserRow?.name ?? '').trim().split(/\s+/)[0] ?? '';
  } catch {
    agencyFirstName = '';
  }

  // ── Agency-wide snapshot counts ────────────────────────────────────────
  // Aggregate across all member spaces (including the owner's own space).
  let unreadLeadCount = 0;
  let agencyFollowUpsDue = 0;
  let agencyDraftsReady = 0;
  try {
    const allMembers = await getAgencyMembers(ctx.agency.id, { includeSpaceName: true });
    const memberSpaceIds = allMembers
      .map((m) => m.Space?.id)
      .filter((id): id is string => Boolean(id));

    // Also include the owner's own space if not already captured.
    if (spaceRow && !memberSpaceIds.includes(spaceRow.id as string)) {
      memberSpaceIds.push(spaceRow.id as string);
    }

    if (memberSpaceIds.length > 0) {
      const now = new Date().toISOString();
      const [leadResult, followUpResult, draftResult] = await Promise.all([
        // new-lead contacts across all member spaces
        supabase
          .from('Contact')
          .select('*', { count: 'exact', head: true })
          .in('spaceId', memberSpaceIds)
          .contains('tags', ['new-lead']),
        // overdue follow-ups on Deal across all member spaces
        supabase
          .from('Deal')
          .select('id', { count: 'exact', head: true })
          .in('spaceId', memberSpaceIds)
          .not('followUpAt', 'is', null)
          .lte('followUpAt', now),
        // pending AgentDrafts across all member spaces
        supabase
          .from('AgentDraft')
          .select('id', { count: 'exact', head: true })
          .in('spaceId', memberSpaceIds)
          .eq('status', 'pending'),
      ]);
      unreadLeadCount = leadResult.count ?? 0;
      agencyFollowUpsDue = followUpResult.count ?? 0;
      agencyDraftsReady = draftResult.count ?? 0;
    } else if (spaceRow) {
      // Fallback: single owner space when member list is empty
      const now = new Date().toISOString();
      const [leadResult, followUpResult, draftResult] = await Promise.all([
        supabase
          .from('Contact')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceRow.id)
          .contains('tags', ['new-lead']),
        supabase
          .from('Deal')
          .select('id', { count: 'exact', head: true })
          .eq('spaceId', spaceRow.id)
          .not('followUpAt', 'is', null)
          .lte('followUpAt', now),
        supabase
          .from('AgentDraft')
          .select('id', { count: 'exact', head: true })
          .eq('spaceId', spaceRow.id)
          .eq('status', 'pending'),
      ]);
      unreadLeadCount = leadResult.count ?? 0;
      agencyFollowUpsDue = followUpResult.count ?? 0;
      agencyDraftsReady = draftResult.count ?? 0;
    }
  } catch {
    unreadLeadCount = 0;
    agencyFollowUpsDue = 0;
    agencyDraftsReady = 0;
  }

  return (
    <div className="app-theme flex h-screen overflow-hidden bg-background text-foreground">
      {/* First-paint splash — greets the agency by name, shows an agency-wide
          snapshot of what's happening across member spaces, then dissolves. */}
      <KoalaSplash
        greeting={pickGreeting(agencyFirstName)}
        snapshot={{
          newLeads: unreadLeadCount,
          followUpsDue: agencyFollowUpsDue,
          draftsReady: agencyDraftsReady,
        }}
      />
      <AccountSwitchSwipe />
      <SidebarCollapseProvider>
        <Sidebar
          slug={slug}
          spaceName={spaceName}
          unreadLeadCount={unreadLeadCount}
          isAgency={true}
          isAgencyOnly={isAgencyOnly}
          agencyName={ctx.agency.name}
          agencyRole={ctx.membership.role}
          agencyMemberships={[{ id: ctx.agency.id, name: ctx.agency.name, role: ctx.membership.role }]}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header slug={slug} spaceName={spaceName} title={spaceName} isAgency={true} isAgencyOnly={isAgencyOnly} agencyName={ctx.agency.name} />
          {/* Chat-vs-dashboard padding is decided client-side by usePathname()
              inside AgencyMain — NOT by the fragile x-pathname header — so the
              container is always correct and nothing touches the screen edge. */}
          <AgencyMain>{children}</AgencyMain>
        </div>
      </SidebarCollapseProvider>
      <MobileNav slug={slug} isAgency={true} isAgencyOnly={isAgencyOnly} />
    </div>
  );
}
