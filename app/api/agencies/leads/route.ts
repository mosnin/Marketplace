import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { requireAgency, canManageLeads } from '@/lib/permissions';
import { getSpaceByOwnerId } from '@/lib/space';
import { routeAgencyLead } from '@/lib/agency-routing';
import { logger } from '@/lib/logger';

const addLeadSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Invalid email address').max(255),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  leadType: z.enum(['rental', 'buyer']),
  budget: z.coerce.number().positive().optional().nullable(),
  notes: z.string().trim().max(4000).optional().or(z.literal('')),
});

/**
 * POST /api/agencies/leads
 *
 * Manually add a single lead to the current agency's space.
 * Auth: agency_owner or agency_admin only.
 */
export async function POST(req: NextRequest) {
  // ── Auth: require agency_owner or agency_admin ───────────────────────────
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!canManageLeads(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the owner or admins can add leads' },
      { status: 403 },
    );
  }

  const { agency } = ctx;

  // ── Parse & validate request body ───────────────────────────────────────
  let requestBody: unknown;
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = addLeadSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { firstName, lastName, email, phone, leadType, budget, notes } = parsed.data;
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  try {
    // ── Find the agency owner's space ─────────────────────────────────
    const ownerSpace = await getSpaceByOwnerId(agency.ownerId);
    if (!ownerSpace) {
      return NextResponse.json(
        { error: 'Agency owner does not have a workspace configured.' },
        { status: 500 },
      );
    }

    // ── Lead routing: if auto-assignment is on and an eligible agent ────
    // exists, insert into their space; otherwise fall back to the owner
    // space. `routeAgencyLead` never throws — null = agency fallback.
    // Pass the validated lead shape so the BP7d rules layer can match on
    // leadType / budget / tags before falling back to round-robin/score.
    const routing = await routeAgencyLead(agency.id, {
      leadType,
      budget: budget ?? null,
      tags: ['agency-lead', 'new-lead'],
    });
    const spaceIdForInsert = routing?.agentSpaceId ?? ownerSpace.id;

    // Resolve the assigned agent's display info for the response UI.
    // Keep backward-compatible: this block never blocks the insert and
    // only adds the new `assignedAgent` field to the response.
    let assignedAgent: { userId: string; name: string } | null = null;
    if (routing) {
      try {
        const { data: agentUser } = await supabase
          .from('User')
          .select('id, name, email')
          .eq('id', routing.agentUserId)
          .maybeSingle();
        const row = agentUser as { id: string; name: string | null; email: string } | null;
        assignedAgent = row
          ? { userId: row.id, name: row.name ?? row.email ?? row.id }
          : { userId: routing.agentUserId, name: routing.agentUserId };
      } catch (err) {
        logger.warn('[agencies/leads] failed to resolve assigned agent name', {
          agencyId: agency.id,
          agentUserId: routing.agentUserId,
        }, err);
        assignedAgent = { userId: routing.agentUserId, name: routing.agentUserId };
      }
    }

    // ── Insert the Contact record ─────────────────────────────────────────
    const { data: contact, error: insertError } = await supabase
      .from('Contact')
      .insert({
        id: crypto.randomUUID(),
        spaceId: spaceIdForInsert,
        agencyId: agency.id,
        name: fullName,
        email: email || null,
        phone: phone || null,
        budget: budget ?? null,
        notes: notes || null,
        leadType,
        type: 'QUALIFICATION',
        services: [],
        tags: ['agency-lead', 'new-lead'],
        scoringStatus: 'pending',
        scoreLabel: 'unscored',
        sourceLabel: 'agency-manual',
      })
      .select('id, name, email, phone, budget, leadType, tags, createdAt, scoreLabel, leadScore, notes')
      .single();

    if (insertError) throw insertError;

    logger.info('[agencies/leads] manual lead created', {
      contactId: contact.id,
      spaceId: spaceIdForInsert,
      agencyId: agency.id,
      leadType,
      routed: routing !== null,
      routingMethod: routing?.method ?? null,
      routingRuleId: routing?.ruleId ?? null,
      assignedUserId: routing?.agentUserId ?? null,
    });

    return NextResponse.json({ success: true, contact, assignedAgent }, { status: 201 });
  } catch (error) {
    logger.error('[agencies/leads] unhandled error', {
      agencyId: agency.id,
    }, error);
    return NextResponse.json({ error: "Server hiccup — usually temporary." }, { status: 500 });
  }
}
