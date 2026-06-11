/**
 * GET /api/ai/agency-messages?conversationId= — messages for an agency Koala
 * conversation.
 *
 * The agency analogue of `app/api/ai/messages/route.ts`. Gated on agency
 * access via `resolveAgencyContext()` (defense layer 2). The conversation is
 * verified to belong to the caller's agency BEFORE any message is returned —
 * a conversationId from another agency (or a provider conversation, which
 * won't even exist in "AgencyConversation") gets a 404, never another
 * agency's history.
 *
 * Storage is structurally separate: messages come from "AgencyMessage", keyed
 * by agencyId + conversationId. There is no path from here into the provider
 * "Message" table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveAgencyContext } from '@/lib/agent/agency-context';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const MESSAGE_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const agencyCtx = await resolveAgencyContext();
    if (!agencyCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { allowed } = await checkRateLimit(`ai:agency-messages:${agencyCtx.agency.ownerId}`, 20, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: 'too many requests. try again shortly.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    const conversationId = req.nextUrl.searchParams.get('conversationId');
    if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 });

    // Verify the conversation belongs to THIS agency before loading any
    // message. agencyId is the boundary — ownership of the conversation row
    // is what gates access, not a title string.
    const { data: conv, error: convErr } = await supabase
      .from('AgencyConversation')
      .select('id, agencyId')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) {
      console.error('[agency-messages] Conversation lookup failed:', convErr);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }
    if (!conv || conv.agencyId !== agencyCtx.agency.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('AgencyMessage')
      .select('id, role, content, blocks, createdAt')
      .eq('conversationId', conversationId)
      .order('createdAt', { ascending: true })
      .limit(MESSAGE_LIMIT);
    if (error) {
      console.error('[agency-messages] Message lookup failed:', error);
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error('[agency-messages] GET error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
