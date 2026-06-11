import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getAgencyMemberContext } from '@/lib/permissions';
import { KoalaWorkspace } from '@/components/koala/koala-workspace';
import { MemberDashboard } from './member-dashboard';
import type { Conversation } from '@/lib/types';
import type { MessageBlock } from '@/lib/ai-tools/blocks';

/**
 * /agency — the agency home.
 *
 * Mirrors the provider home (`/s/[slug]/koala`): the home IS the Koala chat.
 * Owners and admins land on the agency chief-of-staff chat
 * (`KoalaWorkspace variant="agency"`, backed by /api/ai/agency-task), scoped
 * to the whole agency. The team-overview dashboard moved to `/agency/brief`.
 *
 * `provider_member`s are unchanged — they get their own work surface
 * (`MemberDashboard`), never the agency chat.
 */

export const dynamic = 'force-dynamic';

export default async function AgencyHomePage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; prompt?: string; prefill?: string }>;
}) {
  const ctx = await getAgencyMemberContext();
  if (!ctx) redirect('/');

  // provider_member sees their own work surface, not the agency chat.
  if (ctx.membership.role === 'provider_member') {
    return <MemberDashboard ctx={ctx} />;
  }

  const { conversationId: urlConversationId, prompt: urlPrompt, prefill: urlPrefill } = await searchParams;
  const initialPrefill =
    typeof urlPrompt === 'string' && urlPrompt.trim().length > 0
      ? urlPrompt
      : typeof urlPrefill === 'string' && urlPrefill.trim().length > 0
        ? urlPrefill
        : undefined;

  // Agency conversations + messages live in their OWN tables, keyed by
  // agencyId — structurally separate from the provider "Conversation"/
  // "Message" tables. No Space lookup, no title-prefix query.
  const { data: convData } = await supabase
    .from('AgencyConversation')
    .select('*')
    .eq('agencyId', ctx.agency.id)
    .order('updatedAt', { ascending: false })
    .limit(50);
  const conversations = (convData ?? []) as Conversation[];

  let initialMessages: { role: 'user' | 'assistant'; content: string; blocks?: MessageBlock[] | null }[] = [];
  let initialConversationId: string | null = null;

  if (urlConversationId) {
    // Verify the requested conversation belongs to THIS agency BEFORE
    // loading messages. Without this guard an arbitrary conversationId in the
    // URL (another agency's) would render its private history. A provider
    // conversation id simply won't exist in "AgencyConversation".
    const { data: convRow } = await supabase
      .from('AgencyConversation')
      .select('id, agencyId')
      .eq('id', urlConversationId)
      .maybeSingle();
    const isThisAgencyConversation =
      convRow != null && (convRow as { agencyId: string }).agencyId === ctx.agency.id;

    if (isThisAgencyConversation) {
      initialConversationId = urlConversationId;
      const { data: msgData } = await supabase
        .from('AgencyMessage')
        .select('role, content, blocks')
        .eq('conversationId', urlConversationId)
        .order('createdAt', { ascending: true })
        .limit(50);
      initialMessages = ((msgData ?? []) as {
        role: string;
        content: string;
        blocks: MessageBlock[] | null;
      }[]).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        blocks: m.blocks,
      }));
    }
    // Foreign / provider / unknown conversation id → new-chat state.
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <KoalaWorkspace
        slug=""
        variant="agency"
        initialMessages={initialMessages}
        initialConversations={conversations}
        initialConversationId={initialConversationId}
        initialPrefill={initialPrefill}
      />
    </div>
  );
}
