import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveAgencyContext } from '@/lib/agent/agency-context';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/agency/services/[id]/assign — assign a pool service to a member
 * provider (or unassign it).
 *
 * Body: `{ assignedSpaceId: string | null }`. The service must belong to the
 * caller's agency; a non-null target must be a Space in that agency.
 * Once assigned, the provider sees the service in their own workspace.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveAgencyContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { assignedSpaceId?: unknown } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const target =
    body.assignedSpaceId === null || body.assignedSpaceId === ''
      ? null
      : typeof body.assignedSpaceId === 'string'
        ? body.assignedSpaceId
        : undefined;
  if (target === undefined) {
    return NextResponse.json({ error: 'assignedSpaceId must be a space id or null' }, { status: 400 });
  }

  // The service must be in this agency's pool.
  const { data: prop } = await supabase
    .from('Service')
    .select('id, agencyId')
    .eq('id', id)
    .maybeSingle();
  if (!prop || (prop as { agencyId?: string }).agencyId !== ctx.agency.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // A non-null target must be a space inside this agency (a member's, or
  // the owner's own).
  if (target) {
    const { data: space } = await supabase
      .from('Space')
      .select('id, agencyId, ownerId')
      .eq('id', target)
      .maybeSingle();
    const s = space as { agencyId?: string; ownerId?: string } | null;
    const inAgency =
      s && (s.agencyId === ctx.agency.id || s.ownerId === ctx.agency.ownerId);
    if (!inAgency) {
      return NextResponse.json({ error: 'That provider is not in your agency.' }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from('Service')
    .update({ assignedSpaceId: target, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    logger.error('[agency/services/assign] update failed', { agencyId: ctx.agency.id, id }, error);
    return NextResponse.json({ error: 'Failed to assign service' }, { status: 500 });
  }

  return NextResponse.json(data);
}
