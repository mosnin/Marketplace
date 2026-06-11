'use client';

import { useParams } from 'next/navigation';
import { ServiceCard } from './service-card';

interface ServiceSummary {
  id: string;
  address: string;
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  listingStatus?: string;
}

interface ServicesResultData {
  services: ServiceSummary[];
}

export function ServicesResult({ data }: { data: ServicesResultData }) {
  const params = useParams();
  const slug = params?.slug as string | undefined;
  if (!data.services?.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {data.services.map((p, i) => (
        <ServiceCard key={p.id} service={p} slug={slug ?? ''} animDelay={i * 0.05} />
      ))}
    </div>
  );
}
