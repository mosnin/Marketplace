import { redirect } from 'next/navigation';
import { getAgencyContext, canEditSettings } from '@/lib/permissions';
import { ConnectedAppsSection } from '@/components/settings/connected-apps-section';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Integrations — Teams' };

/**
 * /agency/integrations — agency-level connected third-party accounts.
 *
 * TIERED: gated to agency_owner / agency_admin. `getAgencyContext()` only
 * resolves owner/admin memberships, so a provider_member lands here as null
 * and is redirected. `canEditSettings(role)` then decides whether the connect
 * actions render at all — defense in depth on top of the API-side
 * requireAgency() + canEditSettings() gate.
 *
 * Each admin/owner connects their OWN accounts at the agency level via the
 * /api/agency/integrations routes (scoped to agencyId + their userId).
 * These are DISTINCT from their personal provider connections — Composio uses
 * an agency-namespaced entity id, so an agency can connect one inbox
 * personally and a different one for the agency.
 */
export default async function AgencyIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    integration?: string;
    reason?: string;
    toolkit?: string;
  }>;
}) {
  const ctx = await getAgencyContext();
  if (!ctx) redirect('/');

  const { agency, membership } = ctx;
  const canEdit = canEditSettings(membership.role);
  const sp = await searchParams;

  const callbackResult =
    sp.integration === 'connected' || sp.integration === 'failed'
      ? {
          ok: sp.integration === 'connected',
          reason: sp.reason ?? null,
          toolkit: sp.toolkit ?? null,
        }
      : null;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Integrations.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Integrations
        </h1>
        <p className={BODY_MUTED}>
          Connect your tools at the {agency.name} level so Koala can act
          across them.
        </p>
      </header>

      {!canEdit ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">Read-only for your role.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Only the agency owner or admins can connect agency
            integrations.
          </p>
        </div>
      ) : (
        <ConnectedAppsSection
          callbackResult={callbackResult}
          endpoints={{
            list: '/api/agency/integrations',
            connect: (toolkit) => `/api/agency/integrations/connect/${toolkit}`,
            item: (id) => `/api/agency/integrations/${id}`,
            // No health endpoint at the agency level yet — the panel falls
            // back to the static status pill.
          }}
        />
      )}
    </div>
  );
}
