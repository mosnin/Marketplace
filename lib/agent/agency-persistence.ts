/**
 * Message persistence for the agency Koala surface.
 *
 * The agency analogue of `lib/ai-tools/persistence.ts`. Agency conversations
 * and messages live in their OWN tables — "AgencyConversation" / "AgencyMessage"
 * — keyed by `agencyId`, NOT by `spaceId`. That keeps agency-private chat
 * structurally isolated from the provider "Conversation"/"Message" tables: a
 * provider surface cannot read an agency row because the rows are not even in the
 * same table, never mind the same space.
 *
 * Same content-coalescing + content-derivation rules as the provider helpers so
 * an agency message row reads identically (blocks for the renderer, content as
 * the joined text for legacy readers).
 */

import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { coalesceTextBlocks, type MessageBlock } from '@/lib/ai-tools/blocks';

/** Bump the parent conversation's updatedAt so the sidebar orders by recency. */
async function touchConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('AgencyConversation')
    .update({ updatedAt: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) {
    // Non-fatal — the message already saved; ordering is cosmetic.
    logger.warn('[agency-persistence] touch conversation failed', { conversationId }, error);
  }
}

export interface SaveAgencyUserMessageInput {
  agencyId: string;
  conversationId: string;
  content: string;
}

export async function saveAgencyUserMessage(
  input: SaveAgencyUserMessageInput,
): Promise<{ messageId: string }> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('AgencyMessage').insert({
    id,
    agencyId: input.agencyId,
    conversationId: input.conversationId,
    role: 'user',
    content: input.content,
    // User messages are always plain text — no blocks.
  });
  if (error) {
    logger.error('[agency-persistence] saveAgencyUserMessage failed', { agencyId: input.agencyId }, error);
    throw new Error(`Failed to save agency user message: ${error.message}`);
  }
  await touchConversation(input.conversationId);
  return { messageId: id };
}

export interface SaveAgencyAssistantMessageInput {
  agencyId: string;
  conversationId: string;
  blocks: MessageBlock[];
}

export async function saveAgencyAssistantMessage(
  input: SaveAgencyAssistantMessageInput,
): Promise<{ messageId: string }> {
  const merged = coalesceTextBlocks(input.blocks);
  const content = merged
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
    .trim();

  const id = crypto.randomUUID();
  const { error } = await supabase.from('AgencyMessage').insert({
    id,
    agencyId: input.agencyId,
    conversationId: input.conversationId,
    role: 'assistant',
    // A pure tool-only turn has no text — store a short placeholder so legacy
    // readers don't render a blank row.
    content: content || '(tool-only turn)',
    blocks: merged as unknown as Record<string, unknown>[],
  });
  if (error) {
    logger.error('[agency-persistence] saveAgencyAssistantMessage failed', { agencyId: input.agencyId }, error);
    throw new Error(`Failed to save agency assistant message: ${error.message}`);
  }
  await touchConversation(input.conversationId);
  return { messageId: id };
}
