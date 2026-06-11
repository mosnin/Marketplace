/**
 * POST /api/koala/post-appointment
 *
 * Body: { transcript: string, contextHint?: { personId?, dealId? } }
 * Returns: { proposals: ProposedAction[] }
 *
 * The provider records a 30-second appointment debrief; the client transcribes
 * it via /api/koala/transcribe; this route turns the transcript into a
 * stack of intended tool calls (NOT executed) for the provider to approve
 * in one tap. Execution happens via /api/koala/post-appointment/execute once
 * the provider commits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { checkRateLimit } from '@/lib/rate-limit';
import { listTools } from '@/lib/ai-tools/registry';
import { getOpenAIClient, MissingOpenAIKeyError } from '@/lib/ai-tools/openai-client';
import {
  attachHumanSummaries,
  loadPostAppointmentIntegrationTools,
  proposeActions,
} from '@/lib/koala/post-appointment';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface PostAppointmentBody {
  transcript?: unknown;
  contextHint?: { personId?: unknown; dealId?: unknown };
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`koala:post-appointment:${userId}`, 20, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: PostAppointmentBody;
  try {
    body = (await req.json()) as PostAppointmentBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) {
    return NextResponse.json({ error: 'Empty transcript' }, { status: 400 });
  }
  if (transcript.length > 8000) {
    return NextResponse.json({ error: 'Transcript too long' }, { status: 413 });
  }

  const contextHint: { personId?: string; dealId?: string } = {};
  if (body.contextHint && typeof body.contextHint === 'object') {
    if (typeof body.contextHint.personId === 'string') contextHint.personId = body.contextHint.personId;
    if (typeof body.contextHint.dealId === 'string') contextHint.dealId = body.contextHint.dealId;
  }

  let client;
  try {
    ({ client } = getOpenAIClient());
  } catch (err) {
    if (err instanceof MissingOpenAIKeyError) {
      return NextResponse.json({ error: 'OpenAI not configured' }, { status: 500 });
    }
    throw err;
  }

  try {
    // Load the provider's connected-app tools (Gmail, Calendar, ...) so
    // the orchestrator can propose actually sending instead of merely
    // drafting. Failure here degrades gracefully to native-only.
    const integrationTools = await loadPostAppointmentIntegrationTools({
      spaceId: space.id,
      userId,
    });
    const proposals = await proposeActions(client, {
      transcript,
      contextHint,
      tools: listTools(),
      integrationTools,
    });
    const enriched = await attachHumanSummaries(supabase, space.id, proposals);
    return NextResponse.json({ proposals: enriched });
  } catch (err) {
    logger.error('[koala/post-appointment] orchestrator failed', { userId, spaceId: space.id }, err);
    return NextResponse.json({ error: 'Orchestrator failed' }, { status: 500 });
  }
}
