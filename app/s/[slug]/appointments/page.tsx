import { permanentRedirect } from 'next/navigation';

// Appointments used to be its own destination. A appointment is a calendar event with a
// service + contact attached — Calendar now absorbs the surface. Existing
// links and bookmarks 308 over so nothing breaks.
export default async function AppointmentsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  permanentRedirect(`/s/${slug}/calendar`);
}
