/**
 * GET /api/agency/integrations
 *
 * List the calling agency's OWN agency-level connections — one row per
 * (toolkit, status) the agency integrations panel renders. Each admin/owner
 * sees only the accounts they personally connected at the agency level
 * (they OAuth with their own grants).
 *
 * TIERED: gated via requireAgency() (owner/admin only). A provider_member has
 * no agency_owner/agency_admin membership, so requireAgency() throws and this
 * returns 403 — the connect/disconnect actions are never reachable for them.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireAgency } from '@/lib/permissions';
import { listAgencyConnectionsForUser } from '@/lib/integrations/agency-connections';
import { composioConfigured } from '@/lib/integrations/composio';

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const apiKeySet = composioConfigured();

  const all = await listAgencyConnectionsForUser({
    agencyId: ctx.agency.id,
    userId: clerkId,
  });
  // Drop revoked rows — they're audit-only, not agency-facing.
  const visible = all.filter((c) => c.status !== 'revoked');

  const appUrlSet = Boolean(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL);
  const setup = {
    apiKeySet,
    appUrlSet,
    callbackUrl: appUrlSet
      ? `${(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '')}/integrations/callback/agency-setup`
      : null,
  };

  return NextResponse.json({
    configured: apiKeySet,
    setup,
    connections: visible.map((c) => ({
      id: c.id,
      toolkit: c.toolkit,
      status: c.status,
      label: c.label,
      lastError: c.lastError,
      createdAt: c.createdAt,
      // Agency-level connections don't register curated triggers yet, so
      // the watch affordance is always 'off' — the panel renders connect /
      // disconnect only, no pause toggle.
      triggers: 'off' as const,
    })),
  });
}
