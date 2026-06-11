/**
 * DB-side helpers for AgencyIntegrationConnection rows — the agency
 * analogue of connections.ts. Composio holds the OAuth tokens; this table
 * holds the pointer + status + audit. One active row per
 * (agency, user, toolkit) — a reconnect flips the prior row to 'revoked'
 * and inserts a new 'active' row.
 *
 * Scoped by agencyId + the Clerk userId of the admin/owner who connected,
 * so two admins can each connect their OWN Gmail at the agency level
 * without colliding. The Composio plumbing (initiate / get / delete) is NOT
 * forked — it lives in composio.ts and is shared with the provider flow. Only
 * storage and scoping differ here.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { deleteConnection as composioDelete } from './composio';

export type AgencyIntegrationStatus = 'active' | 'expired' | 'revoked' | 'failed';

export interface AgencyIntegrationConnectionRow {
  id: string;
  agencyId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  status: AgencyIntegrationStatus;
  label: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** All connections for an agency, regardless of status. UI filters as needed. */
export async function listAgencyConnections(
  agencyId: string,
): Promise<AgencyIntegrationConnectionRow[]> {
  const { data, error } = await supabase
    .from('AgencyIntegrationConnection')
    .select('*')
    .eq('agencyId', agencyId)
    .order('createdAt', { ascending: false });
  if (error) {
    logger.warn('[integrations.agency-connections] list failed', {
      agencyId,
      err: error.message,
    });
    return [];
  }
  return (data ?? []) as AgencyIntegrationConnectionRow[];
}

/**
 * Connections for a single (agency, user). The agency integrations
 * panel shows each admin only their OWN connected accounts — they connect
 * with their own OAuth grants, so they manage their own rows.
 */
export async function listAgencyConnectionsForUser(args: {
  agencyId: string;
  userId: string;
}): Promise<AgencyIntegrationConnectionRow[]> {
  const { data, error } = await supabase
    .from('AgencyIntegrationConnection')
    .select('*')
    .eq('agencyId', args.agencyId)
    .eq('userId', args.userId)
    .order('createdAt', { ascending: false });
  if (error) {
    logger.warn('[integrations.agency-connections] listForUser failed', {
      agencyId: args.agencyId,
      err: error.message,
    });
    return [];
  }
  return (data ?? []) as AgencyIntegrationConnectionRow[];
}

/** Look up by composio connection id — used by the OAuth callback. */
export async function findAgencyByComposioId(composioConnectionId: string) {
  const { data } = await supabase
    .from('AgencyIntegrationConnection')
    .select('*')
    .eq('composioConnectionId', composioConnectionId)
    .maybeSingle();
  return (data ?? null) as AgencyIntegrationConnectionRow | null;
}

/** Look up by our own row id. */
export async function getAgencyConnectionById(id: string) {
  const { data } = await supabase
    .from('AgencyIntegrationConnection')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as AgencyIntegrationConnectionRow | null;
}

/** Find any active row for this (agency, user, toolkit). */
export async function findActiveAgencyConnection(args: {
  agencyId: string;
  userId: string;
  toolkit: string;
}): Promise<AgencyIntegrationConnectionRow | null> {
  const { data } = await supabase
    .from('AgencyIntegrationConnection')
    .select('*')
    .eq('agencyId', args.agencyId)
    .eq('userId', args.userId)
    .eq('toolkit', args.toolkit)
    .eq('status', 'active')
    .maybeSingle();
  return (data ?? null) as AgencyIntegrationConnectionRow | null;
}

/**
 * Insert a new connection row. Caller is responsible for revoking any prior
 * active row for the same (agency, user, toolkit) BEFORE calling this —
 * the unique-active index will reject otherwise.
 */
export async function insertAgencyConnection(args: {
  agencyId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  label?: string;
}): Promise<AgencyIntegrationConnectionRow | null> {
  const { data, error } = await supabase
    .from('AgencyIntegrationConnection')
    .insert({
      agencyId: args.agencyId,
      userId: args.userId,
      toolkit: args.toolkit,
      composioConnectionId: args.composioConnectionId,
      label: args.label ?? null,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) {
    logger.error('[integrations.agency-connections] insert failed', {
      agencyId: args.agencyId,
      userId: args.userId,
      toolkit: args.toolkit,
      composioConnectionId: args.composioConnectionId,
      hasLabel: Boolean(args.label),
      errCode: (error as { code?: string }).code ?? null,
      errMessage: error.message,
      errDetails: (error as { details?: string }).details ?? null,
      errHint: (error as { hint?: string }).hint ?? null,
    });
    return null;
  }
  return data as AgencyIntegrationConnectionRow;
}

/**
 * Upsert by `composioConnectionId`. Used by the OAuth callback: the connect
 * route persists the row at initiate-time, so the callback updates the label
 * (Composio surfaces the connected user's email after OAuth completes) and
 * bumps status back to 'active' if it drifted. Falls back to insert if the
 * row somehow doesn't exist.
 */
export async function upsertAgencyByComposioId(args: {
  agencyId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  label?: string;
}): Promise<AgencyIntegrationConnectionRow | null> {
  const existing = await findAgencyByComposioId(args.composioConnectionId);
  if (existing) {
    const { error } = await supabase
      .from('AgencyIntegrationConnection')
      .update({
        label: args.label ?? existing.label ?? null,
        status: 'active',
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      logger.error('[integrations.agency-connections] upsertByComposioId update failed', {
        id: existing.id,
        errCode: (error as { code?: string }).code ?? null,
        errMessage: error.message,
      });
      return null;
    }
    return {
      ...existing,
      label: args.label ?? existing.label ?? null,
      status: 'active',
      lastError: null,
    };
  }
  return insertAgencyConnection(args);
}

/** Flip a row's status. Used for reconnect (prior → revoked) and on errors. */
export async function setAgencyConnectionStatus(args: {
  id: string;
  status: AgencyIntegrationStatus;
  lastError?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('AgencyIntegrationConnection')
    .update({
      status: args.status,
      lastError: args.lastError ?? null,
      updatedAt: new Date().toISOString(),
    })
    .eq('id', args.id);
  if (error) {
    logger.warn('[integrations.agency-connections] setStatus failed', {
      id: args.id,
      err: error.message,
    });
  }
}

/**
 * Revoke at Composio AND mark our row revoked. Idempotent. Agency-level
 * connections don't register curated triggers (no inbound-event wiring at the
 * agency level yet), so this is a straight delete-then-mark — no trigger
 * cleanup step like the provider revoke path.
 */
export async function revokeAgencyConnection(
  row: AgencyIntegrationConnectionRow,
): Promise<void> {
  await composioDelete(row.composioConnectionId);
  await setAgencyConnectionStatus({ id: row.id, status: 'revoked' });
}
