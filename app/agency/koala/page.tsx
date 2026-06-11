import { redirect } from 'next/navigation';

/**
 * /agency/koala — folded into the agency home.
 *
 * The agency chat is now the home surface at `/agency` (mirroring the
 * provider home). This route stays as a permanent redirect so existing links,
 * bookmarks, and the `?prompt=` deep-links keep working.
 */
export default async function AgencyKoalaRedirect({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; prompt?: string; prefill?: string }>;
}) {
  const { conversationId, prompt, prefill } = await searchParams;
  const qs = new URLSearchParams();
  if (conversationId) qs.set('conversationId', conversationId);
  if (prompt) qs.set('prompt', prompt);
  if (prefill) qs.set('prefill', prefill);
  const query = qs.toString();
  redirect(query ? `/agency?${query}` : '/agency');
}
