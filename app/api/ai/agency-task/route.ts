/**
 * POST /api/ai/agency-task — agency chat surface streaming endpoint.
 *
 * Parallel to `app/api/ai/task/route.ts` (the provider chat surface) but
 * gated on agency access and dispatched to Modal with `mode: 'agency'`.
 * The shared SSE protocol is identical; the routes differ in auth and in
 * WHERE they persist.
 *
 * STORAGE IS STRUCTURALLY SEPARATE. Agency conversations + messages live in
 * their OWN tables — "AgencyConversation" / "AgencyMessage" — keyed by
 * `agencyId`, NOT in the provider "Conversation"/"Message" tables. A provider
 * surface cannot read a agency row because the rows are not in the same table.
 *
 * RUNTIME SPACE vs. STORAGE. The Modal runtime still needs a `space_id` for
 * AgentSettings/usage/the agent run — that stays the agency owner's personal
 * Space (resolveRuntimeSpaceId). But it is RUNTIME-ONLY; no conversation or
 * message is ever written keyed by that space. If the runtime space can't be
 * resolved, the turn still persists to the agency tables.
 *
 * Defense layer 2 of three (per Koala-for-Agencies Phase 1 spec):
 *
 *   1. ROUTE GUARD   — `app/agency/koala/page.tsx` server component
 *                      redirects when the caller isn't a agency.
 *   2. API GATE      — THIS ROUTE. `resolveAgencyContext()` is the gate;
 *                      provider_member + non-agency + signed-out callers
 *                      all 403 here. The check fires BEFORE any DB writes,
 *                      Modal fetch, or rate-limit increment.
 *   3. TOOL-RUNTIME  — `agent/tools/agency/_guards.py:require_agency_role`
 *                      refuses tool execution unless AgentContext carries
 *                      a agency role (Phase 2/3 tools wrap every handler).
 *
 * Phase 1 ships zero agency tools, so this route exists to wire the pipe.
 * Phase 2/3 add tools by appending to `agent/tools/agency.AGENCY_TOOLS`;
 * the agency-task route itself does NOT need to change.
 */

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { saveAgencyUserMessage, saveAgencyAssistantMessage } from '@/lib/agent/agency-persistence';
import { koalaErrorMessage } from '@/lib/ai-tools/koala-voice';
import { sanitizeUserInput } from '@/lib/agent/prompt-sanitizer';
import { resolveAgencyContext } from '@/lib/agent/agency-context';
import type { MessageBlock } from '@/lib/ai-tools/blocks';
import { auth } from '@clerk/nextjs/server';
import { decideAgencyRoute } from '@/lib/chat/router';
import { streamAgencyDirectTurn } from '@/lib/chat/agency-direct';
import { getTodayTokenUsage } from '@/lib/usage/today-token-usage';
import { isSubscriptionDelinquent } from '@/lib/api-auth';

// A Modal chat turn can run for minutes (multi-tool agentic reasoning). The
// proxy must outlive the Modal function (its timeout is 600s) or Vercel
// kills the stream mid-turn and the assistant message is lost.
export const runtime = 'nodejs';
export const maxDuration = 300;

interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
}

interface PostBody {
  conversationId?: string | null;
  message: string;
}

/** Cap on history messages fed to the model. Mirrors the provider route's
 *  HISTORY_LIMIT — Phase 1 PR #155 dropped that from 20 to 8 to stop
 *  paying for 12 stale turns every request; Phase 3 mirrors the same cut
 *  here. The agency chat surface answers about agency state, not a
 *  many-turn conversation, so 8 is plenty. */
const HISTORY_LIMIT = 8;

/**
 * Resolve the agency owner's personal Space id — RUNTIME USE ONLY.
 *
 * The Modal runtime still needs a `space_id` for AgentSettings/usage/the agent
 * run. The agency owner's personal Space is the anchor. This is NOT where
 * conversations or messages are stored — those live in the agency tables keyed
 * by agencyId. Returns null if the agency owner has no personal Space; the
 * caller treats that as a non-fatal "no runtime space" and still persists the
 * turn to the agency tables.
 */
async function resolveRuntimeSpaceId(agencyOwnerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', agencyOwnerId)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * Find or create the AgencyConversation for this turn.
 *
 * If a conversationId is given, accept it ONLY when the AgencyConversation's
 * agencyId matches this agency's agency — a foreign id (another
 * agency's, or a provider's, which won't even exist in this table) is
 * rejected and a fresh conversation is created instead. No spaceId, no title
 * prefix: the agencyId column is the boundary.
 */
async function resolveConversation(
  agencyId: string,
  conversationId: string | null | undefined,
): Promise<string> {
  if (conversationId) {
    const { data } = await supabase
      .from('AgencyConversation')
      .select('id, agencyId')
      .eq('id', conversationId)
      .maybeSingle();
    if (data && data.agencyId === agencyId) {
      return conversationId;
    }
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from('AgencyConversation').insert({
    id,
    agencyId,
    title: 'New conversation',
  });
  if (error) throw error;
  return id;
}

async function loadHistory(conversationId: string): Promise<HistoryRow[]> {
  const { data } = await supabase
    .from('AgencyMessage')
    .select('role, content, createdAt')
    .eq('conversationId', conversationId)
    .order('createdAt', { ascending: false })
    .limit(HISTORY_LIMIT);

  const rows = ((data ?? []) as Array<{ role: string; content: string }>).reverse();
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
    }));
}

// ---------------------------------------------------------------------------
// Modal SSE proxy — translates Modal's chat_turn events into the
// browser-facing protocol the agency chat client already speaks.
// Same event shape as the provider route.
// ---------------------------------------------------------------------------

interface ProxyModalStreamInput {
  modalBody: ReadableStream<Uint8Array>;
  agencyId: string;
  conversationId: string;
  abortController: AbortController;
}

function proxyModalStream({
  modalBody,
  agencyId,
  conversationId,
  abortController,
}: ProxyModalStreamInput): Response {
  const encoder = new TextEncoder();
  let seq = 0;

  function push(controller: ReadableStreamDefaultController, event: Record<string, unknown>) {
    const line = `data: ${JSON.stringify({ seq: seq++, ts: new Date().toISOString(), ...event })}\n\n`;
    controller.enqueue(encoder.encode(line));
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = modalBody.getReader();
      const decoder = new TextDecoder();
      let lineBuf = '';
      const textChunks: string[] = [];
      const blocks: MessageBlock[] = [];
      let persisted = false;
      let sentTerminal = false;
      async function persistOnce(finalText?: string): Promise<void> {
        if (persisted) return;
        persisted = true;
        let toSave: MessageBlock[] = blocks;
        if (toSave.length === 0 && finalText && finalText.trim()) {
          toSave = [{ type: 'text', content: finalText }];
        }
        if (toSave.length === 0) return;
        try {
          await saveAgencyAssistantMessage({ agencyId, conversationId, blocks: toSave });
        } catch (err) {
          logger.warn('[ai/agency-task] persist assistant message failed', { agencyId }, err);
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuf += decoder.decode(value, { stream: true });
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }

            const type = typeof evt.type === 'string' ? evt.type : '';

            if (type === 'token') {
              const delta = String(evt.delta ?? '');
              textChunks.push(delta);
              blocks.push({ type: 'text', content: delta });
              push(controller, { type: 'text_delta', delta });
            } else if (type === 'reasoning_delta') {
              push(controller, { type: 'reasoning_delta', delta: String(evt.delta ?? '') });
            } else if (type === 'tool_call_start') {
              const toolName = String(evt.tool ?? 'tool');
              const toolArgs = (evt.args ?? {}) as Record<string, unknown>;
              const callId =
                typeof evt.call_id === 'string' && evt.call_id
                  ? evt.call_id
                  : crypto.randomUUID();
              blocks.push({
                type: 'tool_call',
                callId,
                name: toolName,
                args: toolArgs,
                status: 'complete',
              });
              push(controller, {
                type: 'tool_call_start',
                name: toolName,
                args: toolArgs,
                callId,
              });
            } else if (type === 'tool_call_result') {
              const toolName = String(evt.tool ?? 'tool');
              const callId = typeof evt.call_id === 'string' ? evt.call_id : '';
              const ok = evt.ok !== false;
              const summary = String(evt.summary ?? '');
              for (let i = blocks.length - 1; i >= 0; i--) {
                const b = blocks[i];
                if (b.type !== 'tool_call') continue;
                if (callId ? b.callId === callId : !b.result) {
                  b.result = { ok, summary };
                  b.status = ok ? 'complete' : 'error';
                  break;
                }
              }
              push(controller, {
                type: 'tool_call_result',
                name: toolName,
                ok,
                summary,
                callId,
              });
            } else if (type === 'done') {
              const finalText =
                typeof evt.final_text === 'string' && evt.final_text.trim()
                  ? evt.final_text
                  : textChunks.join('');
              await persistOnce(finalText);
              push(controller, { type: 'turn_complete', reason: 'complete' });
              sentTerminal = true;
            } else if (type === 'error') {
              await persistOnce();
              push(controller, { type: 'error', message: evt.message ?? 'Agent error' });
              sentTerminal = true;
            }
          }
        }

        // Flush trailing buffer.
        if (lineBuf.startsWith('data: ')) {
          const raw = lineBuf.slice(6).trim();
          if (raw) {
            try {
              const evt = JSON.parse(raw) as Record<string, unknown>;
              if (evt.type === 'done') {
                const finalText =
                  typeof evt.final_text === 'string' && evt.final_text.trim()
                    ? evt.final_text
                    : textChunks.join('');
                await persistOnce(finalText);
                push(controller, { type: 'turn_complete', reason: 'complete' });
                sentTerminal = true;
              }
            } catch {
              // ignore malformed trailing line
            }
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          logger.error('[ai/agency-task] modal stream read error', { agencyId }, err);
          push(controller, { type: 'error', message: koalaErrorMessage('internal') });
          sentTerminal = true;
        }
      } finally {
        // Safety net — ported from the provider route: a Modal crash / dropped
        // connection / container kill mid-stream previously ended this stream
        // with NO terminal frame, so the agency's EventSource hung open
        // forever. Persist whatever streamed and guarantee exactly one
        // terminal frame unless the client itself aborted.
        await persistOnce();
        if (!sentTerminal && !abortController.signal.aborted) {
          logger.warn('[ai/agency-task] modal stream ended with no terminal event', {
            agencyId,
          });
          push(controller, { type: 'error', message: koalaErrorMessage('internal') });
        }
        controller.close();
        reader.releaseLock();
      }
    },
    cancel() {
      abortController.abort();
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

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ── Layer 2: API gate. Re-check agency context here even though the
  //    server-side page guard already redirected — a misconfigured
  //    client (custom fetch) must still 403 at the route boundary. ──
  const agencyCtx = await resolveAgencyContext();
  if (!agencyCtx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    // resolveAgencyContext returned non-null, which means a Clerk session
    // existed at that moment — but we still need the userId for the
    // Modal entity scope. A null between the two checks is a race; refuse.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
  if (!rawMessage) return NextResponse.json({ error: 'message required' }, { status: 400 });
  if (rawMessage.length > 8000) {
    return NextResponse.json({ error: 'message too long (8000 char max)' }, { status: 400 });
  }

  const sanitized = sanitizeUserInput(rawMessage);
  if (!sanitized.safe) {
    return NextResponse.json(
      { error: 'Message blocked by safety filter', violations: sanitized.violations },
      { status: 400 },
    );
  }
  const message = sanitized.sanitized;

  const agencyId = agencyCtx.agency.id;

  // Rate limits — independent counters, fired together (the provider route got
  // the same treatment). The per-agency limiter is NEW: user- and IP-level
  // limits alone let a multi-admin agency burst far past intent.
  const ip = getClientIp(req);
  const [userLimit, ipLimit, agencyLimit] = await Promise.all([
    checkRateLimit(`ai:agency-task:${clerkUserId}`, 30, 3600),
    checkRateLimit(`chat:ip:${ip}`, 30, 600),
    checkRateLimit(`chat:agency:${agencyId}`, 60, 600),
  ]);
  if (!userLimit.allowed) {
    return NextResponse.json({ error: koalaErrorMessage('rate_limited') }, { status: 429 });
  }
  if (!ipLimit.allowed || !agencyLimit.allowed) {
    return NextResponse.json(
      { error: koalaErrorMessage('rate_limited') },
      { status: 429, headers: { 'Retry-After': '600' } },
    );
  }

  // Dunning gate — a agency's seats are funded by the AGENCY subscription, so
  // gate on the agency's status. The provider route (app/api/ai/task) gates
  // its funding account too; agency-task previously had NO dunning gate, so a
  // lapsed Team kept full premium AI for every seat. Only past_due / canceled /
  // unpaid are gated; active / trialing / inactive pass. Platform admins bypass.
  // Fails OPEN so a DB hiccup can't lock out a paying agency.
  try {
    const { data: bRow } = await supabase
      .from('Agency')
      .select('stripeSubscriptionStatus')
      .eq('id', agencyId)
      .maybeSingle();
    if (isSubscriptionDelinquent(bRow?.stripeSubscriptionStatus ?? 'inactive')) {
      const { data: userRow } = await supabase
        .from('User')
        .select('platformRole')
        .eq('clerkId', clerkUserId)
        .maybeSingle();
      if (userRow?.platformRole !== 'admin') {
        return NextResponse.json(
          {
            error:
              'Your agency subscription needs attention — update the payment method in billing to keep using Koala. Your workspace and data stay available.',
          },
          { status: 402 },
        );
      }
    }
  } catch (err) {
    logger.warn(
      '[ai/agency-task] subscription status check failed — allowing turn',
      { agencyId },
      err,
    );
  }

  // Runtime space — the agency owner's personal Space, needed ONLY for the
  // Modal agent run (AgentSettings/usage). It is NOT where the conversation or
  // messages are stored. A agency owner with no personal Space still gets a
  // working chat: the turn persists to the agency tables; only the Modal
  // settings/usage want a space, and the direct (in-process) path needs none.
  const runtimeSpaceId = await resolveRuntimeSpaceId(agencyCtx.agency.ownerId);

  // Route decision is pure — compute it BEFORE any persistence so an
  // agent-path precondition failure (Modal unconfigured, no runtime space)
  // can refuse cleanly. The previous order saved the user message first and
  // THEN 503'd, leaving an orphaned user message with no assistant reply in
  // the thread.
  const route = decideAgencyRoute(message);
  if (route === 'agent') {
    if (!process.env.MODAL_CHAT_URL) {
      logger.error('[ai/agency-task] MODAL_CHAT_URL not set');
      return NextResponse.json(
        { error: 'Agent backend not configured. Set MODAL_CHAT_URL.' },
        { status: 503 },
      );
    }
    if (!runtimeSpaceId) {
      logger.warn('[ai/agency-task] no runtime space for agentic turn', { agencyId });
      return NextResponse.json(
        { error: 'Agency actions are not available for this agency yet.' },
        { status: 503 },
      );
    }

    // Daily token budget — gate against the runtime (funding) space, BEFORE
    // any persistence. Fails OPEN so a transient DB error can't block a
    // legitimate turn. Default matches the AgentSettings column default
    // (50_000) — same correction the provider route carries.
    try {
      const [settingsResult, usageResult] = await Promise.all([
        supabase
          .from('AgentSettings')
          .select('dailyTokenBudget')
          .eq('spaceId', runtimeSpaceId)
          .maybeSingle(),
        getTodayTokenUsage(runtimeSpaceId),
      ]);
      const dailyTokenBudget: number =
        ((settingsResult.data as { dailyTokenBudget?: number | null } | null)
          ?.dailyTokenBudget as number | null | undefined) ?? 50_000;
      if (usageResult.total >= dailyTokenBudget) {
        logger.warn('[ai/agency-task] daily token budget exceeded', {
          agencyId,
          runtimeSpaceId,
          todayTokens: usageResult.total,
          dailyTokenBudget,
        });
        return NextResponse.json({ error: 'Daily token budget exceeded' }, { status: 429 });
      }
    } catch (err) {
      logger.warn('[ai/agency-task] token budget check failed — continuing', { agencyId }, err);
    }
  }

  const abortController = new AbortController();

  let conversationId: string;
  try {
    conversationId = await resolveConversation(agencyId, body.conversationId ?? null);
  } catch (err) {
    logger.error('[ai/agency-task] conversation resolve failed', { agencyId }, err);
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 500 });
  }

  try {
    await saveAgencyUserMessage({ agencyId, conversationId, content: message });
  } catch (err) {
    logger.error('[ai/agency-task] save user message failed', { agencyId }, err);
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 500 });
  }

  let history: HistoryRow[];
  try {
    history = await loadHistory(conversationId);
  } catch (err) {
    logger.warn(
      '[ai/agency-task] history load failed — continuing without it',
      { agencyId },
      err,
    );
    history = [];
  }

  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === 'user' && last.content === message) history.pop();
  }

  // ── Router: Q&A in-process, actions to Modal ─────────────────────────────
  // Generic Q&A answers in-process from a live agency snapshot — instant,
  // no Modal cold start. Everything agency-domain ("team health", "at-risk
  // agents", "reassign Maria's leads") goes to Modal where AGENCY_TOOLS lives.
  // decideAgencyRoute = the shared provider router PLUS the agency noun set;
  // the plain decideRoute used to send agency-domain reads to the snapshot
  // path, whose prompt is instructed to say it doesn't have the answer —
  // agencies read that as "Koala has no tools". Errors → Modal (safe default).
  if (route === 'direct') {
    logger.info('[ai/agency-task] router → direct (in-process)', { agencyId });
    return streamAgencyDirectTurn({
      agency: agencyCtx.agency,
      // Runtime space is for usage recording only; null is fine (usage just
      // skips). The conversation/message persist goes to the agency tables.
      runtimeSpaceId,
      userId: clerkUserId,
      conversationId,
      userMessage: message,
      history: history.map((h) => ({ role: h.role, content: h.content })),
      abortController,
    });
  }

  // Modal dispatch. `mode: 'agency'` + agency_id + agency_role tell
  // chat_turn to build the agency-variant agent (AGENCY_TOOLS, agency
  // system prompt) and refuse the request if those fields are missing.
  // Preconditions (MODAL_CHAT_URL, runtimeSpaceId) were verified BEFORE the
  // user message was persisted — see the route-decision block above.
  const modalChatUrl = process.env.MODAL_CHAT_URL as string;

  const payload = {
    secret: process.env.AGENT_INTERNAL_SECRET ?? '',
    space_id: runtimeSpaceId,
    user_id: clerkUserId,
    message,
    history: history.map((h) => ({ role: h.role, content: h.content })),
    conversation_id: conversationId,
    // ── Agency-mode fields — Modal's chat_turn reads these to dispatch
    //    to make_agency_agent() and to populate AgentContext for the
    //    per-tool require_agency_role() guard (defense layer 3). ──
    mode: 'agency' as const,
    agency_id: agencyId,
    agency_role: agencyCtx.agencyRole,
  };

  let modalRes: Response;
  try {
    modalRes = await fetch(modalChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
  } catch (err) {
    logger.error('[ai/agency-task] Modal fetch failed', { agencyId }, err);
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 502 });
  }

  if (!modalRes.ok || !modalRes.body) {
    const status = modalRes.status;
    logger.error('[ai/agency-task] Modal returned error', { status, agencyId });
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 502 });
  }

  return proxyModalStream({
    modalBody: modalRes.body,
    agencyId,
    conversationId,
    abortController,
  });
}
