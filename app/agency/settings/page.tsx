import { getAgencyContext } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { AgencySettingsForm } from '@/components/agency/settings-form';
import { AgencyIntakeTrustSignalsForm } from '@/components/agency/intake-trust-signals-form';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'General settings — Teams' };

/**
 * Agency settings — general workspace identity (name, logo, website, privacy
 * policy) and the intake-form trust signals (license, fair-housing notice).
 *
 * The agency dashboard ships its own settings sub-nav (MCP, Auto-Assignment,
 * Routing rules, Billing) via `agencySettingsNavSections` in the sidebar, so
 * this page is the "General" leaf. Same Koala vocabulary as the provider
 * settings page: serif h1 + status sentence, hairline inputs, divide-y
 * sections, PRIMARY_PILL save.
 */
export default async function AgencySettingsPage() {
  const ctx = await getAgencyContext();
  if (!ctx) redirect('/');

  const { agency, membership } = ctx;
  const canEdit = membership.role === 'agency_owner' || membership.role === 'agency_admin';

  const subtitle = canEdit
    ? `${agency.name} — your team's identity and intake.`
    : `${agency.name} — read-only for your role.`;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          General
        </h1>
        <p className={BODY_MUTED}>{subtitle}</p>
      </header>

      <section className="space-y-5">
        <p className={SECTION_LABEL}>Agency</p>
        <AgencySettingsForm
          name={agency.name}
          websiteUrl={agency.websiteUrl}
          logoUrl={agency.logoUrl}
          joinCode={agency.joinCode}
          privacyPolicyHtml={agency.privacyPolicyHtml ?? null}
          isOwner={canEdit}
        />
      </section>

      <section className="space-y-5 pt-10 border-t border-border/60">
        <p className={SECTION_LABEL}>Compliance &amp; trust signals</p>
        <p className={BODY_MUTED}>
          License number, Fair Housing notice, and Equal Housing mark — shown
          in the agency intake-form footer for every provider on your team.
        </p>
        <AgencyIntakeTrustSignalsForm
          licenseNumber={agency.agencyLicenseNumber ?? ''}
          fairHousingNotice={agency.agencyFairHousingNotice ?? ''}
          showEqualHousingMark={agency.agencyShowEqualHousingMark ?? false}
          isOwner={canEdit}
        />
      </section>

      {!canEdit && (
        <p className={BODY_MUTED}>
          Only the agency owner or admins can edit settings.
        </p>
      )}
    </div>
  );
}
