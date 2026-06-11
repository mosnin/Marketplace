import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /koala/activity — legacy URL. The page now lives at /koala/history
 * (provider's noun, not ours). Kept as a redirect for bookmark safety.
 */
export default async function KoalaActivityRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/provider');

  redirect(`/s/${slug}/koala/history`);
}
