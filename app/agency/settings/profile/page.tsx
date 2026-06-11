import { getAgencyContext } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { AgencyProfileForm } from '@/components/agency/profile-form';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Profile — Agency Settings' };

/**
 * /agency/settings/profile — an owner/admin's own profile within the
 * agency. Mirror of the provider profile section.
 *
 * TIERED: `getAgencyContext()` only resolves owner/admin memberships, so a
 * provider_member lands here as null and is redirected. The PATCH route is
 * self-scoped — each agency edits only their own membership row.
 */
export default async function AgencySettingsProfilePage() {
  const ctx = await getAgencyContext();
  if (!ctx) redirect('/');

  const { agency } = ctx;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Profile
        </h1>
        <p className={BODY_MUTED}>
          Your profile within {agency.name} &mdash; how you show up to your
          team.
        </p>
      </header>

      <section className="space-y-5">
        <p className={SECTION_LABEL}>You</p>
        <AgencyProfileForm />
      </section>
    </div>
  );
}
