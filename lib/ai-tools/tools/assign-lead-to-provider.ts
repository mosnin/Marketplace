/**
 * `assign_lead_to_provider` — agency reassigns a Contact to a provider.
 *
 * Approval-gated. Agency-only. Mirrors the assignment record-keeping in
 * `app/api/agency/assign-lead/route.ts` (audit metadata in
 * applicationStatusNote, plus a 'note' ContactActivity entry), but
 * intentionally narrower: we update the existing Contact row's audit fields
 * — we do NOT clone the contact into another provider's space here. The
 * route does the clone for first-time assignment from the agency's intake
 * pool. This tool reassigns an already-owned lead within the agency,
 * which is a smaller operation. Cloning/notification is what the
 * assign-lead route exists for; the agent should call that surface for
 * first-touch lead drops, not this tool.
 *
 * Note: Contact has no `assignedToUserId` column — assignment is recorded
 * via tags + applicationStatusNote (canonical) and the activity note
 * (audit trail). That's the existing convention.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const parameters = z
  .object({
    personId: z.string().min(1).describe('Contact.id to reassign.'),
    providerUserId: z.string().min(1).describe('User.id of the new owner provider.'),
    why: z.string().trim().min(1).max(280).describe('Reassignment reason — appears in the activity log.'),
  })
  .describe('Reassign a Contact to a different provider in the same agency.');

interface AssignResult {
  contactId: string;
  providerUserId: string;
  providerName: string;
}

export const assignLeadToProviderTool = defineTool<typeof parameters, AssignResult>({
  name: 'assign_lead_to_provider',
  riskLevel: 'low',
  description:
    'Agency-only. Reassign a Contact to a different provider in the same agency. Prompts for approval.',
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    return `Reassign contact ${args.personId.slice(0, 8)} → provider ${args.providerUserId.slice(0, 8)}: ${args.why}`;
  },

  async handler(args, ctx) {
    // ── Agency-role gate ────────────────────────────────────────────────────
    const { data: callerUser } = await supabase
      .from('User')
      .select('id')
      .eq('clerkId', ctx.userId)
      .maybeSingle();
    if (!callerUser) {
      return { summary: 'Agency access required.', display: 'error' };
    }
    const { data: callerMemberships } = await supabase
      .from('AgencyMembership')
      .select('agencyId')
      .eq('userId', (callerUser as { id: string }).id)
      .in('role', ['agency_owner', 'agency_admin']);
    const callerAgencyIds = new Set(
      ((callerMemberships ?? []) as Array<{ agencyId: string }>).map((m) => m.agencyId),
    );
    if (callerAgencyIds.size === 0) {
      return { summary: 'Agency access required.', display: 'error' };
    }

    // ── Provider must be in the same agency ──────────────────────────────
    const { data: providerMembership } = await supabase
      .from('AgencyMembership')
      .select('agencyId, userId')
      .eq('userId', args.providerUserId)
      .maybeSingle();
    if (
      !providerMembership ||
      !callerAgencyIds.has((providerMembership as { agencyId: string }).agencyId)
    ) {
      return { summary: 'That provider is not in your agency.', display: 'error' };
    }

    // ── Contact must exist (in this space OR linked to the agency) ──────
    const { data: contact } = await supabase
      .from('Contact')
      .select('id, name, spaceId, agencyId')
      .eq('id', args.personId)
      .maybeSingle();
    if (!contact) {
      return { summary: 'Contact not found.', display: 'error' };
    }
    const c = contact as { id: string; name: string; spaceId: string; agencyId: string | null };
    const agencyId = (providerMembership as { agencyId: string }).agencyId;
    const callerOwnsThisContact = c.spaceId === ctx.space.id || c.agencyId === agencyId;
    if (!callerOwnsThisContact) {
      return { summary: 'Contact not in your agency.', display: 'error' };
    }

    // ── Fetch provider name for the audit note ──────────────────────────────
    const { data: provider } = await supabase
      .from('User')
      .select('id, name, email')
      .eq('id', args.providerUserId)
      .maybeSingle();
    const providerName =
      (provider as { name?: string | null } | null)?.name ??
      (provider as { email?: string } | null)?.email ??
      args.providerUserId;

    // ── Audit-only update: applicationStatusNote + activity note. No clone.
    const now = new Date().toISOString();
    const meta = JSON.stringify({
      assignedTo: args.providerUserId,
      assignedToName: providerName,
      assignedAt: now,
      via: 'on_demand_agent',
      reason: args.why,
    });

    // Scope the UPDATE by the specific ownership leg we just proved at
    // L98 — either the contact lives in the agency's own space, or it's
    // linked to a agency the caller administers. The read-then-write
    // pattern is safe only if the write carries the same scope; a
    // concurrent agency-merge or reassign-elsewhere could otherwise let
    // the UPDATE land on a row that has since moved out of scope.
    const updateBuilder = supabase
      .from('Contact')
      .update({ applicationStatusNote: meta, updatedAt: now })
      .eq('id', c.id);
    const scopedUpdate = c.spaceId === ctx.space.id
      ? updateBuilder.eq('spaceId', ctx.space.id)
      : updateBuilder.eq('agencyId', agencyId);
    const { error: updateErr } = await scopedUpdate;
    if (updateErr) {
      logger.error('[tools.assign_lead] update failed', { contactId: c.id }, updateErr);
      return { summary: `Reassignment failed: ${updateErr.message}`, display: 'error' };
    }

    const { error: activityErr } = await supabase.from('ContactActivity').insert({
      id: crypto.randomUUID(),
      contactId: c.id,
      spaceId: c.spaceId,
      type: 'note',
      content: `Reassigned to ${providerName}: ${args.why}`,
      metadata: { providerUserId: args.providerUserId, via: 'on_demand_agent' },
    });
    if (activityErr) {
      logger.warn('[tools.assign_lead] activity insert failed', { contactId: c.id }, activityErr);
    }

    return {
      summary: `Reassigned ${c.name} to ${providerName}.`,
      data: { contactId: c.id, providerUserId: args.providerUserId, providerName },
      display: 'success',
    };
  },
});
