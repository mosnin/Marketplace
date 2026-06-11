/**
 * DELETE /api/agency/integrations/[id] — disconnect (revoke) an agency-level
 * connection.
 *
 * TIERED: gated via requireAgency() (owner/admin only) AND ownership-scoped —
 * the row must belong to the caller's agency AND to the caller's own
 * userId. A agency can't disconnect another member's connection by guessing
 * an id, and a provider_member can't reach this at all.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireAgency, canEditSettings } from '@/lib/permissions';
import {
  getAgencyConnectionById,
  revokeAgencyConnection,
} from '@/lib/integrations/agency-connections';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!canEditSettings(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the agency owner or admins can manage integrations' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const row = await getAgencyConnectionById(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership: the row must belong to this agency AND this agency. Prevents
  // id-guessing across agencies or across members.
  if (row.agencyId !== ctx.agency.id || row.userId !== clerkId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await revokeAgencyConnection(row);
  return NextResponse.json({ ok: true });
}
