'use client';

import { useParams } from 'next/navigation';
import { AppointmentCard, type AppointmentSummary } from './appointment-card';

interface AppointmentsResultData {
  appointments: AppointmentSummary[];
}

/**
 * Inline rendering of `schedule_appointment` (and any future appointment-listing) tool
 * results. Each appointment renders as an expandable inline card with a mini
 * schedule / timeline view on expand.
 */
export function AppointmentsResult({ data }: { data: AppointmentsResultData }) {
  const params = useParams();
  const slug = params?.slug as string | undefined;

  if (!data.appointments?.length) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {data.appointments.map((t, i) => (
        <AppointmentCard key={t.appointmentId} appointment={t} slug={slug ?? ''} animDelay={i * 0.05} />
      ))}
    </div>
  );
}
