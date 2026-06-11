import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { formatServiceAddress } from '@/lib/services';
import type { Service } from '@/lib/types';
import { ServiceDetailClient } from '@/components/services/service-detail-client';

export const dynamic = 'force-dynamic';

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const { data: service } = await supabase
    .from('Service')
    .select('*')
    .eq('id', id)
    .eq('spaceId', space.id)
    .maybeSingle();
  if (!service) notFound();

  const [{ data: deals }, { data: appointments }] = await Promise.all([
    supabase
      .from('Deal')
      .select('id, title, status, value, closeDate')
      .eq('serviceId', id)
      .eq('spaceId', space.id)
      .order('updatedAt', { ascending: false }),
    supabase
      .from('Appointment')
      .select('id, guestName, startsAt, status')
      .eq('serviceId', id)
      .eq('spaceId', space.id)
      .order('startsAt', { ascending: false })
      .limit(20),
  ]);

  const addr = formatServiceAddress(service as Service);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Breadcrumb — the detail page is no longer an orphan child of /deals.
          Matches the contact-detail breadcrumb pattern: muted "back" link
          with chevron, in muted-foreground. */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Link
          href={`/s/${slug}/services`}
          className="hover:text-foreground transition-colors"
        >
          Services
        </Link>
        <ChevronRight size={11} aria-hidden className="text-muted-foreground/60" />
        <span className="truncate text-foreground">{addr}</span>
      </nav>

      <ServiceDetailClient
        slug={slug}
        initial={service as Service}
        linkedDeals={(deals ?? []) as { id: string; title: string; status: string; value: number | null; closeDate: string | null }[]}
        linkedAppointments={(appointments ?? []) as { id: string; guestName: string; startsAt: string; status: string }[]}
      />
    </div>
  );
}
