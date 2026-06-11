/**
 * Agency direct path — the in-process fast lane for the agency chat.
 *
 * The agency chat used to send EVERY turn to Modal (cold start, the same
 * fragility the provider chat was moved off of). Most agency questions are
 * read-only Q&A — "how's the team doing?", "how many leads are waiting?",
 * "what's our pipeline?" — which need no tools, just the agency's current
 * numbers. This answers those in-process, instantly, from a live snapshot.
 * Action turns (reassign, set a routing rule) still route to Modal, where the
 * AGENCY_TOOLS catalog lives.
 *
 * Mirrors `lib/chat/direct-stream.ts` (the provider direct path): same SSE
 * shape, same persistence + usage recording, just a agency-scoped context
 * block instead of per-space vector retrieval.
 */

import { logger } from '@/lib/logger';
import { saveAgencyAssistantMessage } from '@/lib/agent/agency-persistence';
import { koalaErrorMessage } from '@/lib/ai-tools/koala-voice';
import { recordChatUsage } from '@/lib/usage/record-chat-usage';
import type { MessageBlock } from '@/lib/ai-tools/blocks';
import { runDirectChat, type DirectHistoryRow } from '@/lib/chat/direct-llm';
import { resolveChatModel } from '@/lib/llm';
import { getAgencyMembers } from '@/lib/agency-members';
import { supabase } from '@/lib/supabase';
import { formatCompact } from '@/lib/formatting';

/** The agency chief-of-staff persona for the read-only fast path. */
const AGENCY_INSTRUCTIONS_LITE = `
You are Koala, the chief of staff for a real estate agency owner. A sharp
operator who already knows their team's book of business. Never apologise for
being software, never say "as an AI."

# What you can do here
This is the fast Q&A surface. You answer the agency's questions about the whole
agency using the live snapshot below: team size, pipeline, leads waiting,
won deals. You do NOT take actions here, no routing, no reassigning, no sending.
If the agency asks you to DO something (reassign a lead, set a routing rule,
draft and send), say so plainly so they can phrase it as a request and the
action path picks it up.

# Output
Lead with the answer. Short for simple, structured for synthesis. No hedging,
no emoji, no exclamation, no narration. Name the numbers from the snapshot
verbatim. If the snapshot does not cover something, say you do not have it here
and point them at the relevant page (Providers, Deals, Forecast).
`.trim();

interface AgencyDirectInput {
  agency: { id: string; name: string; ownerId: string };
  /** Agency owner's personal Space — usage recording only, may be null. The
   *  conversation + messages persist to the agency tables, not this space. */
  runtimeSpaceId: string | null;
  userId: string | null;
  conversationId: string;
  userMessage: string;
  history: DirectHistoryRow[];
  model?: string;
  abortController: AbortController;
}

/** Aggregate the agency's current numbers into a compact context block the
 *  direct LLM can answer from. Cheap, parallel counts across member spaces. */
async function buildAgencySnapshot(agency: { id: string; name: string; ownerId: string }): Promise<string> {
  const members = await getAgencyMembers(agency.id, { includeSpaceName: true });
  const spaceIds = members.map((m) => m.Space?.id).filter((id): id is string => Boolean(id));
  const providerCount = members.filter((m) => m.role === 'provider_member').length;
  if (spaceIds.length === 0) {
    return `Agency snapshot (${agency.name}):\n- Providers: ${providerCount}\n- No member workspaces with data yet.`;
  }

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

  const [activeDeals, wonDeals, waitingLeads] = await Promise.all([
    supabase.from('Deal').select('value').in('spaceId', spaceIds).eq('status', 'active').limit(5000),
    supabase.from('Deal').select('value, updatedAt').in('spaceId', spaceIds).eq('status', 'won').gte('updatedAt', monthStart).limit(5000),
    supabase
      .from('Contact')
      .select('id', { count: 'exact', head: true })
      .in('spaceId', spaceIds)
      .contains('tags', ['assigned-by-agency'])
      .is('lastContactedAt', null),
  ]);

  const active = (activeDeals.data ?? []) as { value: number | null }[];
  const won = (wonDeals.data ?? []) as { value: number | null }[];
  const activeValue = active.reduce((s, d) => s + (d.value ?? 0), 0);
  const wonValue = won.reduce((s, d) => s + (d.value ?? 0), 0);
  const waiting = waitingLeads.count ?? 0;

  return [
    `Agency snapshot (${agency.name}), as of now:`,
    `- Providers on the team: ${providerCount}`,
    `- Active deals: ${active.length} worth $${formatCompact(activeValue)} in pipeline`,
    `- Won this month: ${won.length} worth $${formatCompact(wonValue)}`,
    `- Leads routed but not yet contacted (waiting on a first response): ${waiting}`,
  ].join('\n');
}

interface SseEvent {
  type: 'text_delta' | 'turn_complete' | 'error' | 'route_picked';
  [k: string]: unknown;
}

/**
 * Stream a agency Q&A turn in-process. Same SSE protocol as the provider direct
 * path, so the agency chat client needs no changes.
 */
export function streamAgencyDirectTurn(input: AgencyDirectInput): Response {
  const encoder = new TextEncoder();
  let seq = 0;
  const frame = (e: SseEvent) =>
    `data: ${JSON.stringify({ seq: seq++, ts: new Date().toISOString(), ...e })}\n\n`;

  const model = resolveChatModel(input.model);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (e: SseEvent) => {
        try { controller.enqueue(encoder.encode(frame(e))); } catch { /* closed */ }
      };

      push({ type: 'route_picked', route: 'direct' });

      try {
        const snapshot = await buildAgencySnapshot(input.agency);
        const systemMessage = `${AGENCY_INSTRUCTIONS_LITE}\n\n${snapshot}`;

        const result = await runDirectChat({
          model,
          systemMessage,
          history: input.history,
          userMessage: input.userMessage,
          signal: input.abortController.signal,
        });

        if (result.text) push({ type: 'text_delta', delta: result.text });
        push({ type: 'turn_complete', reason: 'complete' });

        if (result.text.trim()) {
          const blocks: MessageBlock[] = [{ type: 'text', content: result.text }];
          try {
            await saveAgencyAssistantMessage({ agencyId: input.agency.id, conversationId: input.conversationId, blocks });
          } catch (err) {
            logger.warn('[agency-direct] save assistant message failed', { agencyId: input.agency.id }, err);
          }
        }
        // Usage is space-scoped; record it only when a runtime space exists.
        if (input.runtimeSpaceId) {
          void recordChatUsage({
            spaceId: input.runtimeSpaceId,
            userId: input.userId,
            conversationId: input.conversationId,
            model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            cachedTokens: result.usage.cachedTokens,
            route: 'direct',
            runtime: 'ts',
          }).catch(() => {});
        }
      } catch (err) {
        const aborted = (err as { name?: string })?.name === 'AbortError';
        if (!aborted) {
          logger.error('[agency-direct] crashed', { agencyId: input.agency.id }, err);
          push({ type: 'error', message: koalaErrorMessage('internal') });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      input.abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
