import { NextRequest, NextResponse } from 'next/server';
import { requireAgency, canManageLeads } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { getSpaceByOwnerId } from '@/lib/space';
import { z } from 'zod';

const unassignLeadSchema = z.object({
  contactId: z.string().uuid('Invalid contact ID'),
});

/**
 * POST /api/agency/unassign-lead
 *
 * Unassigns a previously-assigned agency lead, removing the cloned contact
 * from the provider's space and marking the original agency contact as unassigned.
 * Only agency_owner and agency_admin roles can perform this action.
 *
 * Flow:
 * 1. Verify caller is a agency (owner or admin)
 * 2. Verify the contact exists in the agency's space and has 'assigned' tag
 * 3. Parse assignment metadata to find the cloned contact
 * 4. Delete cloned contact + related deals/deal-contacts from provider's space
 * 5. Update original agency contact: remove 'assigned' tag, add 'unassigned' tag
 * 6. Log unassignment in notes
 */
export async function POST(req: NextRequest) {
  // ── Auth: require agency_owner or agency_admin ───────────────────────────
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Role check: only agency_owner and agency_admin can unassign leads ────
  if (!canManageLeads(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the owner or admins can unassign leads' },
      { status: 403 },
    );
  }

  const { agency, dbUserId } = ctx;

  // ── Parse request body ───────────────────────────────────────────────────
  let requestBody: unknown;
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = unassignLeadSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { contactId } = parsed.data;

  try {
    // ── Find the agency's space ──────────────────────────────────────────
    const agencySpace = await getSpaceByOwnerId(agency.ownerId);
    if (!agencySpace) {
      return NextResponse.json(
        { error: 'Agency space not found' },
        { status: 500 },
      );
    }

    // ── Verify the contact exists in the agency's space ──────────────────
    const { data: contact, error: contactError } = await supabase
      .from('Contact')
      .select('*')
      .eq('id', contactId)
      .eq('spaceId', agencySpace.id)
      .maybeSingle();

    // Check the primary-space error before branching to the secondary lookup
    if (contactError) throw contactError;

    // Also check contacts with agencyId (agency-level leads)
    let agencyContact = contact;
    if (!agencyContact) {
      const { data: agencyContact, error: agencyContactError } = await supabase
        .from('Contact')
        .select('*')
        .eq('id', contactId)
        .eq('agencyId', agency.id)
        .maybeSingle();
      if (agencyContactError) throw agencyContactError;
      agencyContact = agencyContact;
    }
    if (!agencyContact) {
      return NextResponse.json(
        { error: 'Contact not found in your agency space' },
        { status: 404 },
      );
    }

    // ── Verify the contact has 'assigned' tag ────────────────────────────
    const existingTags: string[] = agencyContact.tags ?? [];
    if (!existingTags.includes('assigned')) {
      return NextResponse.json(
        { error: 'This lead is not currently assigned' },
        { status: 409 },
      );
    }

    // ── Parse assignment metadata ────────────────────────────────────────
    type AssignmentMeta = {
      assignedTo: string;
      assignedToName: string;
      assignedContactId: string;
      assignedSpaceId: string;
      assignedAt: string;
    };

    let meta: AssignmentMeta | null = null;
    if (agencyContact.applicationStatusNote) {
      try {
        meta = JSON.parse(agencyContact.applicationStatusNote) as AssignmentMeta;
      } catch {
        // Invalid JSON — metadata is corrupted, still allow unassignment
      }
    }

    if (!meta?.assignedContactId) {
      return NextResponse.json(
        { error: 'Assignment metadata missing — cannot identify assigned contact' },
        { status: 422 },
      );
    }

    const { assignedContactId, assignedSpaceId, assignedTo, assignedToName } = meta;

    // ── Validate the assigned contact's space belongs to a agency member ──
    // Prevents corrupted/tampered metadata from deleting arbitrary contacts.
    if (assignedSpaceId) {
      const { data: assignedSpace } = await supabase
        .from('Space')
        .select('ownerId')
        .eq('id', assignedSpaceId)
        .maybeSingle();

      if (assignedSpace) {
        const { data: assignedMembership } = await supabase
          .from('AgencyMembership')
          .select('id')
          .eq('agencyId', agency.id)
          .eq('userId', assignedSpace.ownerId)
          .maybeSingle();

        if (!assignedMembership) {
          return NextResponse.json(
            { error: 'Assigned contact does not belong to a member of this agency' },
            { status: 403 },
          );
        }
      }
    }

    // ── Fetch the admin's name for audit logging ─────────────────────────
    const { data: adminUser } = await supabase
      .from('User')
      .select('name, email')
      .eq('id', dbUserId)
      .maybeSingle();
    const adminName = adminUser?.name ?? adminUser?.email ?? dbUserId;

    const providerName = assignedToName ?? assignedTo ?? 'Unknown';

    // ── Bind the delete blast radius to (assignedContactId, assignedSpaceId) ──
    // The assignedSpaceId check above proved the SPACE belongs to a member
    // of this agency. It did NOT prove `assignedContactId` actually
    // lives in `assignedSpaceId` — which means tampered or stale
    // `applicationStatusNote` metadata could point at a contact id from a
    // different provider's space. An unscoped DELETE would then whack the
    // wrong contact. Verify the binding explicitly before any deletion.
    if (assignedSpaceId) {
      const { data: clonedContactRow } = await supabase
        .from('Contact')
        .select('id')
        .eq('id', assignedContactId)
        .eq('spaceId', assignedSpaceId)
        .maybeSingle();
      if (!clonedContactRow) {
        // Either the provider already deleted their copy (benign) or the
        // metadata is corrupted. Skip the delete pass entirely — the
        // agency-side tag flip below still runs, which is the only
        // operation the agency actually cares about.
        console.warn('[unassign-lead] cloned contact not found in assigned space — skipping delete', {
          assignedContactId,
          assignedSpaceId,
          agencyId: agency.id,
        });
      } else {
        // Cleanup is safe to run, scoped by (contactId, spaceId) at every
        // step so a future code path that drops the binding check still
        // can't reach across tenants.
        try {
          // Delete DealContact links first (FK constraint). DealContact has
          // no spaceId column, but the contactId predicate is already
          // scoped: we just proved this contactId lives in the right space.
          const { data: dealContactLinks } = await supabase
            .from('DealContact')
            .select('dealId, contactId')
            .eq('contactId', assignedContactId);

          if (dealContactLinks && dealContactLinks.length > 0) {
            const dealIds = dealContactLinks.map(
              (dc: { dealId: string }) => dc.dealId,
            );

            await supabase
              .from('DealContact')
              .delete()
              .eq('contactId', assignedContactId);

            // Orphan-deal sweep — drop only deals in the provider's space
            // that have no remaining contact links. Belt: every delete is
            // double-scoped (id + spaceId) so even a stray dealId from
            // another tenant can't be touched.
            for (const dealId of dealIds) {
              const { data: remainingLinks } = await supabase
                .from('DealContact')
                .select('id')
                .eq('dealId', dealId)
                .limit(1);

              if (!remainingLinks || remainingLinks.length === 0) {
                await supabase
                  .from('Deal')
                  .delete()
                  .eq('id', dealId)
                  .eq('spaceId', assignedSpaceId);
              }
            }
          }

          // Delete the cloned contact itself, scoped by spaceId.
          const { error: deleteError } = await supabase
            .from('Contact')
            .delete()
            .eq('id', assignedContactId)
            .eq('spaceId', assignedSpaceId);

          // If the provider already deleted the contact, that's fine.
          if (deleteError) {
            console.warn('[unassign-lead] could not delete cloned contact', {
              assignedContactId,
              assignedSpaceId,
              error: deleteError,
            });
          }
        } catch (cleanupErr) {
          // If the provider already deleted their copy, we still proceed
          // with the agency-side tag flip below.
          console.warn('[unassign-lead] cleanup of provider contact failed', {
            assignedContactId,
            assignedSpaceId,
            cleanupErr,
          });
        }
      }
    } else {
      // No assignedSpaceId in the metadata — legacy assignment or
      // corrupted note. Don't attempt cross-space cleanup blindly.
      console.warn('[unassign-lead] assignment metadata lacks assignedSpaceId — skipping cleanup', {
        contactId,
        agencyId: agency.id,
      });
    }

    // ── Update agency contact: remove 'assigned', add 'unassigned' ───────
    const now = new Date().toISOString();
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const unassignmentNote = [
      agencyContact.notes,
      `\nUnassigned from ${providerName} on ${dateStr} by ${adminName}`,
    ]
      .filter(Boolean)
      .join('\n');

    const updatedTags = [
      ...existingTags.filter((t: string) => t !== 'assigned' && t !== 'new-lead'),
      'unassigned',
    ];

    const { error: updateError } = await supabase
      .from('Contact')
      .update({
        tags: updatedTags,
        notes: unassignmentNote,
        applicationStatus: 'unassigned',
        applicationStatusNote: null,
        updatedAt: now,
      })
      .eq('id', contactId);
    if (updateError) throw updateError;

    console.info('[unassign-lead] lead unassigned', {
      contactId,
      assignedContactId,
      agencyId: agency.id,
      providerName,
      unassignedBy: dbUserId,
    });

    return NextResponse.json(
      {
        success: true,
        contactId,
        unassignedFrom: providerName,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[unassign-lead] unhandled error', {
      contactId,
      agencyId: agency.id,
      error,
    });
    return NextResponse.json({ error: "Server hiccup — usually temporary." }, { status: 500 });
  }
}
