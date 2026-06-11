/**
 * Rename / delete a single agency Koala conversation.
 *
 * The agency analogue of `app/api/ai/conversations/[id]/route.ts`. Gated on
 * agency access via `resolveAgencyContext()` (defense layer 2), and every
 * mutation is scoped to the caller's agency: the row must belong to THIS
 * agency or it 404s. Operates on the separate "AgencyConversation" /
 * "AgencyMessage" tables — never the provider "Conversation"/"Message" tables.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveAgencyContext } from '@/lib/agent/agency-context';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const rateLimited = () =>
  NextResponse.json(
    { error: 'too many requests. try again shortly.' },
    { status: 429, headers: { 'Retry-After': '60' } },
  );

/** Resolve the conversation only if it belongs to the caller's agency. */
async function ownedConversation(conversationId: string, agencyId: string) {
  const { data } = await supabase
    .from('AgencyConversation')
    .select('id, agencyId')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || data.agencyId !== agencyId) return null;
  return data;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agencyCtx = await resolveAgencyContext();
  if (!agencyCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:agency-conversations:${agencyCtx.agency.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const { id } = await params;
  const conv = await ownedConversation(id, agencyCtx.agency.id);
  if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

  const { title } = await req.json();
  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('AgencyConversation')
    .update({ title: title.trim(), updatedAt: new Date().toISOString() })
    .eq('id', id)
    .eq('agencyId', agencyCtx.agency.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: 'Failed to rename conversation' }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agencyCtx = await resolveAgencyContext();
  if (!agencyCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:agency-conversations:${agencyCtx.agency.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const { id } = await params;
  const conv = await ownedConversation(id, agencyCtx.agency.id);
  if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

  // "AgencyMessage" rows cascade on the conversation FK, so deleting the
  // conversation row removes its messages too.
  const { error } = await supabase
    .from('AgencyConversation')
    .delete()
    .eq('id', id)
    .eq('agencyId', agencyCtx.agency.id);
  if (error) return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });

  return NextResponse.json({ success: true });
}
