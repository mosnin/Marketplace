/**
 * /integrations/callback/agency-setup — where Composio redirects an agency after
 * a successful agency-level OAuth flow.
 *
 * Mirrors the provider callback (/integrations/callback) but persists into
 * AgencyIntegrationConnection scoped to the agency's agency + their own
 * userId, and redirects back to /agency/integrations. Server component so the
 * persistence happens before the agency ever sees a UI flash.
 *
 * TIERED: requireAgency() gates this — a provider_member landing here (they
 * never would, since they can't initiate) is bounced to /agency, which the
 * agency layout itself redirects away from non-agencies.
 */

import { redirect } from 'next/navigation';
import { requireAgency } from '@/lib/permissions';
import { auth } from '@clerk/nextjs/server';
import { getComposio } from '@/lib/integrations/composio';
import {
  upsertAgencyByComposioId,
  findActiveAgencyConnection,
  revokeAgencyConnection,
} from '@/lib/integrations/agency-connections';
import { findIntegration } from '@/lib/integrations/catalog';
import { logger } from '@/lib/logger';

export default async function AgencyIntegrationsCallback({
  searchParams,
}: {
  searchParams: Promise<{ connected_account_id?: string; status?: string; app?: string }>;
}) {
  const sp = await searchParams;
  const { connected_account_id: connectedAccountId, status, app: appQuery } = sp;

  logger.info('[agency.integrations.callback] entered', {
    hasConnectedAccountId: Boolean(connectedAccountId),
    status: status ?? null,
    appQuery: appQuery ?? null,
  });

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    logger.warn('[agency.integrations.callback] no clerk session — redirecting to login');
    redirect('/login/provider');
  }

  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    logger.warn('[agency.integrations.callback] caller is not an agency — bouncing');
    redirect('/agency');
  }

  if (!connectedAccountId) {
    logger.warn('[agency.integrations.callback] missing connected_account_id', { sp });
    return redirect(buildBackUrl({ ok: false, reason: 'missing_account' }));
  }

  // Composio is the source of truth for what just connected.
  let toolkit: string | null = null;
  let label: string | null = null;
  try {
    const composio = getComposio();
    const account = await composio.connectedAccounts.get(connectedAccountId);
    toolkit = (account?.toolkit?.slug ?? appQuery ?? null) as string | null;
    label = pickLabel(account);
    logger.info('[agency.integrations.callback] account fetched', {
      connectedAccountId,
      toolkit,
      hasLabel: Boolean(label),
    });
  } catch (err) {
    logger.error('[agency.integrations.callback] account fetch failed', {
      connectedAccountId,
      err: err instanceof Error ? err.message : String(err),
    });
    toolkit = appQuery ?? null;
  }

  if (!toolkit) {
    return redirect(buildBackUrl({ ok: false, reason: 'unknown_toolkit' }));
  }
  if (!findIntegration(toolkit)) {
    logger.warn('[agency.integrations.callback] toolkit not in catalog', { toolkit });
    return redirect(buildBackUrl({ ok: false, reason: 'unsupported_toolkit' }));
  }

  const agencyId = ctx.agency.id;

  // Reconnect: revoke any prior active row for this triple before upsert.
  const existing = await findActiveAgencyConnection({
    agencyId,
    userId: clerkId,
    toolkit,
  });
  if (existing && existing.composioConnectionId !== connectedAccountId) {
    logger.info('[agency.integrations.callback] revoking prior active row before reconnect', {
      id: existing.id,
      toolkit,
    });
    await revokeAgencyConnection(existing);
  }

  const inserted = await upsertAgencyByComposioId({
    agencyId,
    userId: clerkId,
    toolkit,
    composioConnectionId: connectedAccountId,
    label: label ?? undefined,
  });

  if (!inserted) {
    logger.error('[agency.integrations.callback] upsert returned null', {
      agencyId,
      userId: clerkId,
      toolkit,
      connectedAccountId,
    });
    return redirect(buildBackUrl({ ok: false, reason: 'persist_failed', toolkit }));
  }

  if (status && status.toUpperCase() !== 'ACTIVE') {
    logger.warn('[agency.integrations.callback] composio returned non-active status', {
      connectedAccountId,
      status,
    });
    return redirect(buildBackUrl({ ok: false, reason: status, toolkit }));
  }

  return redirect(buildBackUrl({ ok: true, toolkit }));
}

interface CallbackResultArgs {
  ok: boolean;
  reason?: string;
  toolkit?: string;
}

function buildBackUrl(args: CallbackResultArgs): string {
  const params = new URLSearchParams();
  params.set('integration', args.ok ? 'connected' : 'failed');
  if (args.reason) params.set('reason', args.reason);
  if (args.toolkit) params.set('toolkit', args.toolkit);
  return `/agency/integrations?${params.toString()}`;
}

function pickLabel(account: unknown): string | null {
  if (!account || typeof account !== 'object') return null;
  const a = account as Record<string, unknown>;
  const fromTop =
    (typeof a.email === 'string' && a.email) ||
    (typeof a.username === 'string' && a.username) ||
    null;
  if (fromTop) return fromTop;
  const data = a.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const fromData =
      (typeof d.email === 'string' && d.email) ||
      (typeof d.username === 'string' && d.username) ||
      null;
    if (fromData) return fromData;
  }
  return null;
}
