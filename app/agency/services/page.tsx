import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveAgencyContext } from '@/lib/agent/agency-context';
import { AgencyServicesClient } from './services-client';

export const metadata: Metadata = { title: 'Services — Agency' };

export default async function AgencyServicesPage() {
  const ctx = await resolveAgencyContext();
  if (!ctx) redirect('/');

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <AgencyServicesClient />
    </div>
  );
}
