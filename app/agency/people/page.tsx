import { redirect } from 'next/navigation';
import { resolveAgencyContext } from '@/lib/agent/agency-context';
import { AgencyPeopleTable } from './agency-people-table';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'People' };

export default async function AgencyPeoplePage() {
  const ctx = await resolveAgencyContext();
  if (!ctx) redirect('/');

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <AgencyPeopleTable />
    </div>
  );
}
